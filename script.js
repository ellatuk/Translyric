;(function () {
    'use strict'

    const LOG = '[Translyric]'
    const ADDON_NAME = 'Translyric'
    
    // ---------- Значения по умолчанию ----------
    const DEFAULTS = {
        targetLang: 'ru',
        translationEnabled: true,
        fontSize: 18,
        textColor: '#ffffffcc',
        fontFamily: 'inherit',
        showIcon: true,
        iconType: 'languages',
        iconColorSync: false,
        iconColor: '#ffffff',
        errorIconType: 'bug'
    }
    
    // ---------- Настройки ----------
    let targetLang = DEFAULTS.targetLang
    let translationEnabled = DEFAULTS.translationEnabled
    let fontSize = DEFAULTS.fontSize
    let textColor = DEFAULTS.textColor
    let fontFamily = DEFAULTS.fontFamily
    let showIcon = DEFAULTS.showIcon
    let iconType = DEFAULTS.iconType
    let iconColorSync = DEFAULTS.iconColorSync
    let iconColor = DEFAULTS.iconColor
    let errorIconType = DEFAULTS.errorIconType

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

    // Кэш переводов
    const translationCache = new Map()
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith('translyric_')) {
                try {
                    const value = JSON.parse(localStorage.getItem(key))
                    if (value && value.meta && typeof value.meta.text === 'string') {
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
    let currentAbortController = null

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

    // ---------- Коллекция SVG-иконок ----------
    const ICONS = {
        languages: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
        mic: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/></svg>`,
        notepad: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/></svg>`,
        cat: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/></svg>`,
        turtle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z"/><path d="M4.82 7.9 8 10"/><path d="M15.18 7.9 12 10"/><path d="M16.93 10H20a2 2 0 0 1 0 4H2"/></svg>`,
        worm: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 12-1.5 3"/><path d="M19.63 18.81 22 20"/><path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z"/></svg>`,
        snail: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0"/><circle cx="10" cy="13" r="8"/><path d="M2 21h12c4.4 0 8-3.6 8-8V7a2 2 0 1 0-4 0v6"/><path d="M18 3 19.1 5.2"/><path d="M22 3 20.9 5.2"/></svg>`,
        star: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`,
        'list-music': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5H3"/><path d="M11 12H3"/><path d="M11 19H3"/><path d="M21 16V5"/><circle cx="18" cy="16" r="3"/></svg>`,
        music: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><path d="m9 9 12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
        ban: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/></svg>`,
        bug: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/></svg>`,
        'cloud-alert': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12v4"/><path d="M12 20h.01"/><path d="M8.128 16.949A7 7 0 1 1 15.71 8h1.79a1 1 0 0 1 0 9h-1.642"/></svg>`,
        'circle-x': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
        'search-alert': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 7v4"/><path d="M11 15h.01"/></svg>`
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

    async function requestGtx(text, signal) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
        const res = await fetch(url, { signal })
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

    async function requestGtxWithSplitFallback(text, depth, signal) {
        try {
            return await requestGtx(text, signal)
        } catch (e) {
            if (e && e.status === 400 && depth < 6 && text.length > 120) {
                const [left, right] = splitTextIntoTwo(text)
                if (!left || !right) throw e
                const leftResult = await requestGtxWithSplitFallback(left, depth + 1, signal)
                await new Promise(r => setTimeout(r, CHUNK_GAP_MS))
                const rightResult = await requestGtxWithSplitFallback(right, depth + 1, signal)
                return {
                    text: String(leftResult.text || '') + '\n' + String(rightResult.text || ''),
                    sourceLang: leftResult.sourceLang || rightResult.sourceLang || null,
                }
            }
            throw e
        }
    }

    async function fetchTranslationBlockMeta(text, signal) {
        const key = text
        if (!key.trim()) {
            return { text: '', sameAsTarget: false, sourceLang: null }
        }
        const cached = translationCache.get(key)
        if (cached && cached.generation === batchGeneration) {
            return cached.meta
        }

        const gtx = await requestGtxWithSplitFallback(key, 0, signal)
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

        translationCache.set(key, { meta, generation: batchGeneration })
        try {
            localStorage.setItem('translyric_' + key, JSON.stringify({ meta, generation: batchGeneration }))
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

    async function translateGroup(lines, signal) {
        if (!lines.length) return { parts: [], skip: false, sourceLang: null }
        const joined = lines.join('\n')
        const meta = await fetchTranslationBlockMeta(joined, signal)
        if (meta.sameAsTarget) {
            return { parts: [], skip: true, sourceLang: meta.sourceLang }
        }
        return {
            parts: splitToLineCount(meta.text, lines.length),
            skip: false,
            sourceLang: meta.sourceLang
        }
    }

    async function translateAllTexts(texts, signal) {
        if (!texts.length) return { parts: [], sourceLang: null }
        const groups = chunkLineGroups(texts)
        const result = []
        let overallSourceLang = null
        for (let g = 0; g < groups.length; g++) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
            if (g > 0) await new Promise(r => setTimeout(r, CHUNK_GAP_MS))
            const chunk = groups[g]
            const { parts, skip, sourceLang } = await translateGroup(chunk, signal)
            if (!overallSourceLang && sourceLang) overallSourceLang = sourceLang
            if (skip) {
                for (let i = 0; i < chunk.length; i++) result.push(null)
            } else {
                for (let i = 0; i < parts.length; i++) result.push(parts[i])
            }
        }
        return { parts: result, sourceLang: overallSourceLang }
    }

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
            iconWrap.innerHTML = ICONS[iconType] || ICONS.languages
            const textEl = document.createElement('span')
            textEl.className = 'ps-lyrics-tr_text'
            slot.appendChild(iconWrap)
            slot.appendChild(textEl)
        } else {
            const iconWrap = slot.querySelector('.ps-lyrics-tr_icon')
            if (iconWrap) {
                iconWrap.innerHTML = ICONS[iconType] || ICONS.languages
            }
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
            const iconColorValue = iconColorSync ? textColor : iconColor
            iconEl.style.color = iconColorValue
            iconEl.style.fill = 'none'
        }
        slot.style.display = translationEnabled ? 'flex' : 'none'
    }

    function updateAllSlotsStyles() {
        document.querySelectorAll('.ps-lyrics-tr').forEach(slot => applyDynamicStyles(slot))
    }

    function updateAllIcons() {
        const icons = document.querySelectorAll('.ps-lyrics-tr_icon')
        console.log(LOG, `Updating ${icons.length} icons to "${iconType}"`)
        icons.forEach(iconEl => {
            iconEl.innerHTML = ICONS[iconType] || ICONS.languages
        })
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

        if (currentAbortController) {
            currentAbortController.abort()
        }
        currentAbortController = new AbortController()
        const signal = currentAbortController.signal

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

        translateAllTexts(texts, signal).then(res => {
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
            if (signal.aborted) {
                console.log(LOG, 'Request aborted')
                return
            }
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
                    iconEl.innerHTML = ICONS[errorIconType] || ICONS.ban
                    iconEl.style.display = showIcon ? 'inline-flex' : 'none'
                    const iconColorValue = iconColorSync ? textColor : iconColor
                    iconEl.style.color = iconColorValue
                }
                const textEl = getTrTextEl(slot)
                if (textEl) textEl.textContent = 'Ошибка'
                let errorTooltip = 'Ошибка перевода'
                if (err.status === 429) errorTooltip = 'Превышен лимит запросов к Google Translate. Попробуйте позже.'
                else if (err.status >= 500) errorTooltip = 'Сервер Google Translate временно недоступен.'
                else if (err.message.includes('fetch')) errorTooltip = 'Проблема с сетью. Проверьте подключение к интернету.'
                slot.setAttribute('title', errorTooltip)
                applyDynamicStyles(slot)
            }
        })
    }

    // ------------------ PULSESYNC API ------------------
    let handleData = null
    let settingsApi = null

    function unwrapSetting(entry, fallback) {
        if (Array.isArray(entry)) {
            entry = entry.length > 0 ? entry[0] : fallback
        }
        if (entry && typeof entry === 'object') {
            if (typeof entry.value !== 'undefined') return entry.value
            if (typeof entry.default !== 'undefined') return entry.default
        }
        return typeof entry !== 'undefined' ? entry : fallback
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

            const handleRes = await fetch(`http://localhost:2007/get_handle?name=${encodeURIComponent(ADDON_NAME)}`, { cache: 'no-cache' })
            if (handleRes.ok) {
                const json = await handleRes.json()
                handleData = json.data
            } else {
                console.warn(LOG, 'Could not fetch handleData')
            }

            settingsApi = await window.pulsesyncApi.getSettings(ADDON_NAME)
            const currentSettings = settingsApi.getCurrent()
            applySettingsFromObject(currentSettings)

            settingsApi.onChange((newSettings) => {
                console.log(LOG, 'Settings changed via API', newSettings)
                if (newSettings.btn_reset_settings && newSettings.btn_reset_settings.event === 'reset_settings') {
                    resetAllSettings()
                    return
                }
                applySettingsFromObject(newSettings)
            })

            if (window.pulsesyncApi.hotkeys) {
                window.pulsesyncApi.hotkeys.onPress('toggle_translation', () => {
                    const newValue = !translationEnabled
                    settingsApi.set({ toggle_enable: newValue })
                    showNotification('Перевод ' + (newValue ? 'включён' : 'выключен'))
                })

                window.pulsesyncApi.hotkeys.onPress('next_language', () => {
                    currentLangIndex = (currentLangIndex + 1) % LANG_LIST.length
                    const newLang = LANG_LIST[currentLangIndex]
                    settingsApi.set({ sel_lang: newLang.code })
                    showNotification(`Язык перевода: ${newLang.name}`)
                })

                window.pulsesyncApi.hotkeys.onPress('clear_cache', () => {
                    resetTranslationState()
                    showNotification('Кэш переводов очищен')
                    processAllLines()
                })
            }

            console.log(LOG, 'Settings and hotkeys initialized')
        } catch (e) {
            console.warn(LOG, 'Error initializing settings', e)
        }
    }

    function showNotification(message) {
        if (window.pulsesyncApi?.notifications) {
            window.pulsesyncApi.notifications.show({
                title: 'Translyric',
                message,
                type: 'info',
                timeout: 1500
            })
        }
    }

    function resetAllSettings() {
        targetLang = DEFAULTS.targetLang
        translationEnabled = DEFAULTS.translationEnabled
        fontSize = DEFAULTS.fontSize
        textColor = DEFAULTS.textColor
        fontFamily = DEFAULTS.fontFamily
        showIcon = DEFAULTS.showIcon
        iconType = DEFAULTS.iconType
        iconColorSync = DEFAULTS.iconColorSync
        iconColor = DEFAULTS.iconColor
        errorIconType = DEFAULTS.errorIconType

        settingsApi.set({
            toggle_enable: translationEnabled,
            sel_lang: targetLang,
            slider_font_size: fontSize,
            color_text: textColor,
            sel_font: 'inherit',
            input_custom_font: '',
            toggle_icon: showIcon,
            sel_icon: iconType,
            toggle_icon_color_sync: iconColorSync,
            color_icon: iconColor,
            sel_error_icon: errorIconType
        })

        resetTranslationState()
        updateAllSlotsStyles()
        updateAllIcons()
        lastAppliedSignature = ''
        pendingSignature = ''
        processAllLines()
        showNotification('Настройки сброшены до стандартных')
        console.log(LOG, 'Settings reset to defaults')
    }

    function getSelectorValue(itemId, rawValue, fallback) {
        if (!handleData) return fallback
        for (const section of handleData.sections) {
            if (!section.items) continue
            for (const item of section.items) {
                if (item.id === itemId && item.type === 'selector' && Array.isArray(item.options)) {
                    const idx = Number(rawValue)
                    if (!isNaN(idx) && idx >= 0 && idx < item.options.length) {
                        const opt = item.options[idx]
                        return opt.value !== undefined ? opt.value : opt.event
                    }
                    const defaultIdx = item.defaultParameter !== undefined ? item.defaultParameter : item.defaultValue
                    if (defaultIdx !== undefined && item.options[defaultIdx]) {
                        const opt = item.options[defaultIdx]
                        return opt.value !== undefined ? opt.value : opt.event
                    }
                }
            }
        }
        return fallback
    }

    function applySettingsFromObject(settings) {
        let changed = false
        let langChanged = false
        let enabledChanged = false
        let styleChanged = false

        const rawLang = unwrapSetting(settings.sel_lang, targetLang)
        let newTargetLang = rawLang
        if (!isNaN(Number(rawLang))) {
            newTargetLang = getSelectorValue('sel_lang', rawLang, targetLang)
        } else {
            newTargetLang = normalizeTargetLang(rawLang)
        }

        const newTranslationEnabled = unwrapSetting(settings.toggle_enable, translationEnabled)
        const newFontSize = unwrapSetting(settings.slider_font_size, fontSize)
        const newTextColor = unwrapSetting(settings.color_text, textColor)
        
        const rawFont = unwrapSetting(settings.sel_font, fontFamily)
        let newFontFamily = rawFont
        if (!isNaN(Number(rawFont))) {
            newFontFamily = getSelectorValue('sel_font', rawFont, fontFamily)
        }
        
        const customFont = unwrapSetting(settings.input_custom_font, '')
        const newShowIcon = unwrapSetting(settings.toggle_icon, showIcon)
        
        const rawIcon = unwrapSetting(settings.sel_icon, iconType)
        let newIconType = rawIcon
        if (!isNaN(Number(rawIcon))) {
            newIconType = getSelectorValue('sel_icon', rawIcon, iconType)
        }
        
        const newIconColorSync = unwrapSetting(settings.toggle_icon_color_sync, iconColorSync)
        const newIconColor = unwrapSetting(settings.color_icon, iconColor)
        
        const rawErrorIcon = unwrapSetting(settings.sel_error_icon, errorIconType)
        let newErrorIconType = rawErrorIcon
        if (!isNaN(Number(rawErrorIcon))) {
            newErrorIconType = getSelectorValue('sel_error_icon', rawErrorIcon, errorIconType)
        }

        if (newFontFamily === 'custom' && customFont.trim() !== '') {
            let processed = customFont.trim()
            if (!processed.includes('"') && !processed.includes("'") && processed.includes(',')) {
                processed = processed.split(',').map(part => {
                    part = part.trim()
                    return part.includes(' ') ? `'${part}'` : part
                }).join(', ')
            }
            newFontFamily = processed
        } else if (newFontFamily === 'custom') {
            newFontFamily = 'inherit'
        }

        const foundIndex = LANG_LIST.findIndex(l => l.code === newTargetLang)
        if (foundIndex !== -1) currentLangIndex = foundIndex

        if (newTargetLang !== targetLang) { targetLang = newTargetLang; langChanged = true; changed = true; }
        if (newTranslationEnabled !== translationEnabled) { translationEnabled = newTranslationEnabled; enabledChanged = true; changed = true; }
        if (newFontSize !== fontSize) { fontSize = newFontSize; styleChanged = true; changed = true; }
        if (newTextColor !== textColor) { textColor = newTextColor; styleChanged = true; changed = true; }
        if (newFontFamily !== fontFamily) { fontFamily = newFontFamily; styleChanged = true; changed = true; }
        if (newShowIcon !== showIcon) { showIcon = newShowIcon; styleChanged = true; changed = true; }
        if (newIconType !== iconType) {
            console.log(LOG, `Icon type changed from ${iconType} to ${newIconType}`)
            iconType = newIconType
            styleChanged = true
            changed = true
            updateAllIcons()
        }
        if (newIconColorSync !== iconColorSync) { iconColorSync = newIconColorSync; styleChanged = true; changed = true; }
        if (newIconColor !== iconColor) { iconColor = newIconColor; styleChanged = true; changed = true; }
        if (newErrorIconType !== errorIconType) { errorIconType = newErrorIconType; styleChanged = true; changed = true; }

        if (!changed) return

        console.log(LOG, 'Applying new settings:', {
            targetLang, translationEnabled, fontSize, textColor, fontFamily, showIcon, iconType, iconColorSync, iconColor, errorIconType
        })

        if (langChanged) resetTranslationState()
        if (styleChanged) {
            updateAllSlotsStyles()
            setTimeout(() => updateAllIcons(), 50)
        }
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