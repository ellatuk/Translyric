;(function () {
    'use strict'

    const LOG = '[Translyric]'
    const ADDON_NAME = 'Translyric'
    
    // ---------- Настройки ----------
    let targetLang = 'ru'
    let translationEnabled = true
    let fontSize = 14
    let textColor = '#ffffffcc'
    let fontFamily = 'inherit'
    let showIcon = true

    const MAX_BATCH_CHARS = 4000
    const DEBOUNCE_MS = 200
    const CHUNK_GAP_MS = 80

    // Список языков для горячих клавиш
    const LANG_LIST = [
        { code: 'ru', name: 'Русский' },
        { code: 'en', name: 'English' },
        { code: 'uk', name: 'Украинский' },
        { code: 'be', name: 'Белорусский' },
        { code: 'kk', name: 'Казахский' },
        { code: 'de', name: 'Deutsch' },
        { code: 'fr', name: 'Français' },
        { code: 'es', name: 'Español' },
        { code: 'it', name: 'Italiano' },
        { code: 'pt', name: 'Português' },
        { code: 'pl', name: 'Polski' },
        { code: 'tr', name: 'Türkçe' },
        { code: 'ar', name: 'العربية' },
        { code: 'ja', name: '日本語' },
        { code: 'ko', name: '한국어' },
        { code: 'zh-CN', name: '简体中文' },
        { code: 'zh-TW', name: '繁體中文' }
    ]
    let currentLangIndex = 0

    const translationCache = new Map()
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith('translyric_')) {
                try {
                    const value = JSON.parse(localStorage.getItem(key))
                    if (value && typeof value.text === 'string') {
                        translationCache.set(key.slice(10), value)
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}

    let debounceTimer = null
    let batchGeneration = 0
    let lastAppliedSignature = ''
    let pendingSignature = ''

    const LANGUAGE_ALIAS_TO_CODE = {
        auto: 'auto',
        rus: 'ru', ru: 'ru',
        eng: 'en', en: 'en',
        deu: 'de', de: 'de',
        fra: 'fr', fr: 'fr',
        ita: 'it', it: 'it',
        spa: 'es', es: 'es',
        por: 'pt', pt: 'pt',
        tr: 'tr', tur: 'tr',
        pl: 'pl', pol: 'pl',
        ukr: 'uk', uk: 'uk',
        be: 'be',
        kaz: 'kk', kk: 'kk',
        uz: 'uz',
        ja: 'ja', jpn: 'ja',
        ko: 'ko', kor: 'ko',
        zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', cn: 'zh-CN',
        ar: 'ar', hi: 'hi', vi: 'vi', id: 'id', th: 'th',
        nl: 'nl', sv: 'sv', cs: 'cs', ro: 'ro', hu: 'hu', el: 'el',
    }

    function normalizeTargetLang(raw) {
        const value = String(raw || '').trim().toLowerCase().replace(/_/g, '-')
        if (!value) return targetLang
        return LANGUAGE_ALIAS_TO_CODE[value] || value
    }

    function resetTranslationState() {
        translationCache.clear()
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && key.startsWith('translyric_')) {
                    localStorage.removeItem(key)
                }
            }
        } catch (e) {}
        pendingSignature = ''
        lastAppliedSignature = ''
        batchGeneration++
    }

    function debounceProcess() {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(processAllLines, DEBOUNCE_MS)
    }

    function parseGtxJson(data) {
        try {
            if (!data || !Array.isArray(data[0])) return ''
            return data[0].map(part => part && part[0] != null ? String(part[0]) : '').join('')
        } catch (e) {
            console.warn(LOG, 'parse error', e)
            return ''
        }
    }

    function extractDetectedLang(data) {
        try {
            if (!data || !Array.isArray(data)) return null
            if (typeof data[2] === 'string') return data[2]
            if (Array.isArray(data[2]) && data[2].length) {
                const x = data[2][0]
                if (typeof x === 'string') return x
                if (Array.isArray(x) && typeof x[0] === 'string') return x[0]
            }
            if (typeof data[8] === 'string') return data[8]
        } catch (e) {}
        return null
    }

    function normalizeLang(code) {
        if (!code) return ''
        const s = String(code).toLowerCase().replace(/_/g, '-')
        return s.split('-')[0] || ''
    }

    async function requestGtx(text) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
        const res = await fetch(url)
        if (!res.ok) {
            const err = new Error('HTTP ' + res.status)
            err.status = res.status
            throw err
        }
        const data = await res.json()
        return {
            text: parseGtxJson(data),
            sourceLang: extractDetectedLang(data),
        }
    }

    function splitTextIntoTwo(text) {
        const s = String(text)
        const mid = Math.floor(s.length / 2)
        const nl = s.indexOf('\n', mid)
        const leftByNl = nl > 0 ? s.slice(0, nl) : ''
        const rightByNl = nl > 0 ? s.slice(nl + 1) : ''
        if (leftByNl && rightByNl) return [leftByNl, rightByNl]
        return [s.slice(0, mid), s.slice(mid)]
    }

    async function requestGtxWithSplitFallback(text, depth) {
        try {
            return await requestGtx(text)
        } catch (e) {
            if (e && e.status === 400 && depth < 6 && text.length > 120) {
                const [left, right] = splitTextIntoTwo(text)
                if (!left || !right) throw e
                const leftResult = await requestGtxWithSplitFallback(left, depth + 1)
                await new Promise(r => setTimeout(r, CHUNK_GAP_MS))
                const rightResult = await requestGtxWithSplitFallback(right, depth + 1)
                return {
                    text: String(leftResult.text || '') + '\n' + String(rightResult.text || ''),
                    sourceLang: leftResult.sourceLang || rightResult.sourceLang || null,
                }
            }
            throw e
        }
    }

    async function fetchTranslationBlockMeta(text) {
        const key = text
        if (!key.trim()) {
            return { text: '', sameAsTarget: false, sourceLang: null }
        }
        if (translationCache.has(key)) {
            return translationCache.get(key)
        }

        const gtx = await requestGtxWithSplitFallback(key, 0)
        const out = gtx.text
        const sourceLang = gtx.sourceLang
        const srcNorm = normalizeLang(sourceLang)
        const tgtNorm = normalizeLang(targetLang)
        const sameAsTarget = Boolean(srcNorm && tgtNorm && srcNorm === tgtNorm)

        const meta = {
            text: out,
            sourceLang: sourceLang,
            sameAsTarget: sameAsTarget,
        }

        translationCache.set(key, meta)
        try {
            localStorage.setItem('translyric_' + key, JSON.stringify(meta))
        } catch (e) {}

        return meta
    }

    function chunkLineGroups(texts) {
        const groups = []
        let buf = []
        let bufLen = 0
        for (let i = 0; i < texts.length; i++) {
            const line = texts[i]
            const add = line.length + (buf.length ? 1 : 0)
            if (buf.length && bufLen + add > MAX_BATCH_CHARS) {
                groups.push(buf)
                buf = []
                bufLen = 0
            }
            buf.push(line)
            bufLen += add
        }
        if (buf.length) groups.push(buf)
        return groups
    }

    function splitToLineCount(translated, expectedCount) {
        if (expectedCount <= 0) return []
        let parts = String(translated).split(/\r?\n/)
        if (parts.length === expectedCount) return parts
        if (parts.length > expectedCount) {
            const head = parts.slice(0, expectedCount - 1)
            const tail = parts.slice(expectedCount - 1).join(' ')
            return head.concat([tail])
        }
        while (parts.length < expectedCount) parts.push('')
        return parts.slice(0, expectedCount)
    }

    async function translateGroup(lines) {
        if (!lines.length) return { parts: [], skip: false, sourceLang: null }
        const joined = lines.join('\n')
        const meta = await fetchTranslationBlockMeta(joined)
        if (meta.sameAsTarget) {
            return { parts: [], skip: true, sourceLang: meta.sourceLang }
        }
        return {
            parts: splitToLineCount(meta.text, lines.length),
            skip: false,
            sourceLang: meta.sourceLang
        }
    }

    async function translateAllTexts(texts) {
        if (!texts.length) return { parts: [], sourceLang: null }
        const groups = chunkLineGroups(texts)
        const result = []
        let overallSourceLang = null
        for (let g = 0; g < groups.length; g++) {
            if (g > 0) await new Promise(r => setTimeout(r, CHUNK_GAP_MS))
            const chunk = groups[g]
            const { parts, skip, sourceLang } = await translateGroup(chunk)
            if (!overallSourceLang && sourceLang) overallSourceLang = sourceLang
            if (skip) {
                for (let i = 0; i < chunk.length; i++) result.push(null)
            } else {
                for (let i = 0; i < parts.length; i++) result.push(parts[i])
            }
        }
        return { parts: result, sourceLang: overallSourceLang }
    }

    const TRANSLATE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`
    const ERROR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/></svg>`

    function getOriginalSpan(lineEl) {
        return lineEl.querySelector(':scope > span:not(.ps-lyrics-tr)')
    }

    function ensureTrSlot(lineEl) {
        let slot = lineEl.querySelector(':scope > span.ps-lyrics-tr')
        if (!slot) {
            slot = document.createElement('span')
            slot.className = 'ps-lyrics-tr'
            slot.setAttribute('aria-hidden', 'true')
            lineEl.appendChild(slot)
        }
        if (!slot.querySelector('.ps-lyrics-tr_text')) {
            slot.innerHTML = ''
            const iconWrap = document.createElement('span')
            iconWrap.className = 'ps-lyrics-tr_icon'
            iconWrap.setAttribute('aria-hidden', 'true')
            iconWrap.innerHTML = TRANSLATE_ICON_SVG
            const textEl = document.createElement('span')
            textEl.className = 'ps-lyrics-tr_text'
            slot.appendChild(iconWrap)
            slot.appendChild(textEl)
        }
        applyDynamicStyles(slot)
        return slot
    }

    function applyDynamicStyles(slot) {
        if (!slot) return
        const textEl = slot.querySelector('.ps-lyrics-tr_text')
        const iconEl = slot.querySelector('.ps-lyrics-tr_icon')
        if (textEl) {
            textEl.style.fontSize = fontSize + 'px'
            textEl.style.color = textColor
            textEl.style.fontFamily = fontFamily
        }
        if (iconEl) {
            iconEl.style.display = showIcon ? 'inline-flex' : 'none'
        }
        slot.style.display = translationEnabled ? 'flex' : 'none'
    }

    function updateAllSlotsStyles() {
        document.querySelectorAll('.ps-lyrics-tr').forEach(slot => applyDynamicStyles(slot))
    }

    function getTrTextEl(slot) {
        return slot.querySelector(':scope > .ps-lyrics-tr_text')
    }

    function clearLineState(lineEl) {
        lineEl.removeAttribute('data-ps-loading')
        lineEl.removeAttribute('data-ps-tr')
        lineEl.removeAttribute('data-ps-src')
        lineEl.removeAttribute('data-ps-skip')
        const tr = lineEl.querySelector(':scope > span.ps-lyrics-tr')
        if (tr) tr.remove()
    }

    function collectLyrics() {
        const nodes = document.querySelectorAll('[data-test-id="SYNC_LYRICS_LINE"]')
        const lineEls = []
        const texts = []
        nodes.forEach(lineEl => {
            const orig = getOriginalSpan(lineEl)
            if (!orig) return
            const text = orig.textContent.trim()
            lineEls.push(lineEl)
            texts.push(text)
        })
        return { lineEls, texts }
    }

    function makeSignature(texts) {
        return texts.join('\n')
    }

    function processAllLines() {
        const { lineEls, texts } = collectLyrics()
        const sig = makeSignature(texts)

        if (!lineEls.length) {
            lastAppliedSignature = ''
            pendingSignature = ''
            return
        }

        if (!translationEnabled) {
            lineEls.forEach(clearLineState)
            lastAppliedSignature = ''
            pendingSignature = ''
            return
        }

        const allRendered = sig === lastAppliedSignature &&
            lineEls.every((el, i) => {
                if (!texts[i]) return true
                return (el.hasAttribute('data-ps-tr') || el.hasAttribute('data-ps-skip')) &&
                       !el.hasAttribute('data-ps-loading')
            })
        if (allRendered) return
        if (pendingSignature === sig) return

        pendingSignature = sig
        const gen = ++batchGeneration

        lineEls.forEach((lineEl, i) => {
            if (!texts[i]) {
                clearLineState(lineEl)
            } else {
                lineEl.dataset.psSrc = texts[i]
                lineEl.removeAttribute('data-ps-tr')
                lineEl.removeAttribute('data-ps-skip')
                lineEl.setAttribute('data-ps-loading', '1')
                const slot = ensureTrSlot(lineEl)
                const textEl = getTrTextEl(slot)
                if (textEl) textEl.textContent = ''
                slot.classList.add('ps-lyrics-tr_loading')
            }
        })

        const nonEmptyTexts = texts.filter(t => t.trim().length > 0)
        if (!nonEmptyTexts.length) {
            lineEls.forEach(clearLineState)
            lastAppliedSignature = sig
            pendingSignature = ''
            return
        }

        translateAllTexts(texts).then(res => {
            if (gen !== batchGeneration) return

            const parts = res.parts
            const sourceLangPrefix = ''

            for (let i = 0; i < lineEls.length; i++) {
                const lineEl = lineEls[i]
                if (!lineEl.isConnected) continue
                const t = texts[i]
                if (!t) {
                    clearLineState(lineEl)
                    continue
                }
                if (parts[i] == null) {
                    clearLineState(lineEl)
                    lineEl.setAttribute('data-ps-skip', '1')
                    continue
                }

                let tr = parts[i] != null && String(parts[i]).trim() !== '' ? String(parts[i]) : '—'
                tr = sourceLangPrefix + tr

                lineEl.removeAttribute('data-ps-loading')
                lineEl.removeAttribute('data-ps-skip')
                lineEl.setAttribute('data-ps-tr', tr)
                const slot = ensureTrSlot(lineEl)
                slot.classList.remove('ps-lyrics-tr_loading')
                const textEl = getTrTextEl(slot)
                if (textEl) textEl.textContent = tr
                applyDynamicStyles(slot)
            }
            lastAppliedSignature = sig
            pendingSignature = ''
        }).catch(err => {
            console.warn(LOG, 'batch translate failed', err)
            if (gen !== batchGeneration) return
            pendingSignature = ''
            for (let i = 0; i < lineEls.length; i++) {
                const lineEl = lineEls[i]
                if (!lineEl.isConnected || !texts[i]) continue
                lineEl.removeAttribute('data-ps-loading')
                const slot = ensureTrSlot(lineEl)
                slot.classList.remove('ps-lyrics-tr_loading')
                const iconEl = slot.querySelector('.ps-lyrics-tr_icon')
                if (iconEl) {
                    iconEl.innerHTML = ERROR_ICON_SVG
                    iconEl.style.display = showIcon ? 'inline-flex' : 'none'
                }
                const textEl = getTrTextEl(slot)
                if (textEl) textEl.textContent = 'Ошибка'
                applyDynamicStyles(slot)
            }
        })
    }

    // ------------------ PULSESYNC API ------------------
    let handleData = null; // сохраним описание всех опций

    function unwrapSetting(entry, fallback) {
        if (Array.isArray(entry)) {
            entry = entry.length > 0 ? entry[0] : fallback;
        }
        if (entry && typeof entry === 'object') {
            if (typeof entry.value !== 'undefined') return entry.value;
            if (typeof entry.default !== 'undefined') return entry.default;
        }
        return typeof entry !== 'undefined' ? entry : fallback;
    }

    async function initializeSettings() {
        try {
            let attempts = 0
            while (!window.pulsesyncApi && attempts < 50) {
                await new Promise(r => setTimeout(r, 100))
                attempts++
            }
            if (!window.pulsesyncApi) {
                console.warn(LOG, 'pulsesyncApi not available')
                return
            }

            // Получаем handleData
            const handleRes = await fetch(`http://localhost:2007/get_handle?name=${encodeURIComponent(ADDON_NAME)}`, { cache: 'no-cache' });
            if (handleRes.ok) {
                const json = await handleRes.json();
                handleData = json.data;
            } else {
                console.warn(LOG, 'Could not fetch handleData, selectors may not work properly');
            }

            const settings = await window.pulsesyncApi.getSettings(ADDON_NAME)
            const currentSettings = settings.getCurrent()
            applySettingsFromObject(currentSettings)

            settings.onChange((newSettings) => {
                console.log(LOG, 'Settings changed via API', newSettings)
                applySettingsFromObject(newSettings)
            })

            if (window.pulsesyncApi.hotkeys) {
                window.pulsesyncApi.hotkeys.onPress('toggle_translation', () => {
                    const newValue = !translationEnabled
                    settings.set({ toggle_enable: newValue })
                    if (window.pulsesyncApi.notifications) {
                        window.pulsesyncApi.notifications.show({
                            title: 'Translyric',
                            message: newValue ? 'Перевод включён' : 'Перевод выключен',
                            type: 'info',
                            timeout: 1500
                        })
                    }
                })

                window.pulsesyncApi.hotkeys.onPress('next_language', () => {
                    currentLangIndex = (currentLangIndex + 1) % LANG_LIST.length
                    const newLang = LANG_LIST[currentLangIndex]
                    settings.set({ sel_lang: newLang.code })
                    if (window.pulsesyncApi.notifications) {
                        window.pulsesyncApi.notifications.show({
                            title: 'Translyric',
                            message: `Язык перевода: ${newLang.name}`,
                            type: 'info',
                            timeout: 1500
                        })
                    }
                })

                window.pulsesyncApi.hotkeys.onPress('clear_cache', () => {
                    resetTranslationState()
                    if (window.pulsesyncApi.notifications) {
                        window.pulsesyncApi.notifications.show({
                            title: 'Translyric',
                            message: 'Кэш переводов очищен',
                            type: 'info',
                            timeout: 2000
                        })
                    }
                    processAllLines()
                })
            }

            console.log(LOG, 'Settings and hotkeys initialized')
        } catch (e) {
            console.warn(LOG, 'Error initializing settings', e)
        }
    }

    function getSelectorValue(itemId, rawValue, fallback) {
        if (!handleData) return fallback;
        // Ищем описание селектора
        for (const section of handleData.sections) {
            if (!section.items) continue;
            for (const item of section.items) {
                if (item.id === itemId && item.type === 'selector' && Array.isArray(item.options)) {
                    const idx = Number(rawValue);
                    if (!isNaN(idx) && idx >= 0 && idx < item.options.length) {
                        const opt = item.options[idx];
                        // приоритет: value, затем event (для sel_lang)
                        return opt.value !== undefined ? opt.value : opt.event;
                    }
                    // если индекс невалидный, берём defaultValue
                    const defaultIdx = item.defaultValue;
                    if (defaultIdx !== undefined && item.options[defaultIdx]) {
                        const opt = item.options[defaultIdx];
                        return opt.value !== undefined ? opt.value : opt.event;
                    }
                }
            }
        }
        return fallback;
    }

    function applySettingsFromObject(settings) {
        let changed = false
        let langChanged = false
        let enabledChanged = false
        let styleChanged = false

        // Извлекаем значения с учётом селекторов
        const rawLang = unwrapSetting(settings.sel_lang, targetLang);
        // Если это число (индекс) - преобразуем через getSelectorValue
        let newTargetLang = rawLang;
        if (!isNaN(Number(rawLang))) {
            newTargetLang = getSelectorValue('sel_lang', rawLang, targetLang);
        } else {
            newTargetLang = normalizeTargetLang(rawLang);
        }

        const newTranslationEnabled = unwrapSetting(settings.toggle_enable, translationEnabled)
        const newFontSize = unwrapSetting(settings.slider_font_size, fontSize)
        const newTextColor = unwrapSetting(settings.color_text, textColor)
        
        const rawFont = unwrapSetting(settings.sel_font, fontFamily);
        let newFontFamily = rawFont;
        if (!isNaN(Number(rawFont))) {
            newFontFamily = getSelectorValue('sel_font', rawFont, fontFamily);
        }
        
        const customFont = unwrapSetting(settings.input_custom_font, '')
        const newShowIcon = unwrapSetting(settings.toggle_icon, showIcon)

        // Если выбран "Свой шрифт", используем значение из поля ввода
        if (newFontFamily === 'custom' && customFont.trim() !== '') {
            newFontFamily = customFont.trim();
        } else if (newFontFamily === 'custom') {
            newFontFamily = 'inherit';
        }

        const foundIndex = LANG_LIST.findIndex(l => l.code === newTargetLang)
        if (foundIndex !== -1) currentLangIndex = foundIndex

        if (newTargetLang !== targetLang) {
            targetLang = newTargetLang
            langChanged = true
            changed = true
        }
        if (newTranslationEnabled !== translationEnabled) {
            translationEnabled = newTranslationEnabled
            enabledChanged = true
            changed = true
        }
        if (newFontSize !== fontSize) {
            fontSize = newFontSize
            styleChanged = true
            changed = true
        }
        if (newTextColor !== textColor) {
            textColor = newTextColor
            styleChanged = true
            changed = true
        }
        if (newFontFamily !== fontFamily) {
            fontFamily = newFontFamily
            styleChanged = true
            changed = true
        }
        if (newShowIcon !== showIcon) {
            showIcon = newShowIcon
            styleChanged = true
            changed = true
        }

        if (!changed) return

        console.log(LOG, 'Applying new settings:', {
            targetLang, translationEnabled, fontSize, textColor, fontFamily, showIcon
        })

        if (langChanged) resetTranslationState()
        if (styleChanged) updateAllSlotsStyles()
        if (langChanged || enabledChanged) {
            lastAppliedSignature = ''
            pendingSignature = ''
            processAllLines()
        }
    }

    // ------------------ ЗАПУСК ------------------
    const observer = new MutationObserver(() => debounceProcess())
    observer.observe(document.body, { childList: true, subtree: true })

    initializeSettings().then(() => processAllLines())
})()