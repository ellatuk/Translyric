;(function () {
    'use strict'

    const LOG = '[Translyric]'
    const SETTINGS_NAME = 'Translyric'
    const DEFAULT_TARGET_LANG = 'ru'
    let targetLang = DEFAULT_TARGET_LANG

    const MAX_BATCH_CHARS = 4000
    const DEBOUNCE_MS = 200
    const CHUNK_GAP_MS = 80

    // Кеш для переводов
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
        if (!value) return DEFAULT_TARGET_LANG
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

    // Иконка Lucide "Languages"
    const TRANSLATE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`

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
        return slot
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
                lineEl.setAttribute('data-ps-tr', '—')
                const slot = ensureTrSlot(lineEl)
                slot.classList.remove('ps-lyrics-tr_loading')
                const textEl = getTrTextEl(slot)
                if (textEl) textEl.textContent = '—'
            }
        })
    }

    // ------------------ Настройки ------------------
    async function fetchSettingsFile() {
        try {
            const res = await fetch('http://localhost:2007/get_handle?name=' + encodeURIComponent(SETTINGS_NAME))
            if (!res.ok) return null
            const json = await res.json()
            return json && json.data ? json.data : null
        } catch (e) {
            console.warn(LOG, 'failed to fetch settings', e)
            return null
        }
    }

    async function fetchSelectedValues() {
        try {
            const res = await fetch('pulsesync.settings.json')
            if (!res.ok) return null
            return await res.json()
        } catch (e) {
            return null
        }
    }

    async function loadLanguageSetting() {
        try {
            const [handleData, selectedValues] = await Promise.all([fetchSettingsFile(), fetchSelectedValues()])
            if (!handleData || !handleData.sections) return

            for (const section of handleData.sections) {
                if (!section.items) continue
                for (const item of section.items) {
                    if (item.type !== 'selector') continue
                    const itemId = item.id
                    const rawValue = selectedValues && selectedValues[itemId] !== undefined
                        ? selectedValues[itemId]
                        : item.defaultValue
                    const idx = Number(rawValue) || 0
                    const options = item.options
                    if (Array.isArray(options) && options[idx]) {
                        const ev = options[idx].event
                        if (ev) {
                            const newLang = normalizeTargetLang(ev)
                            if (newLang !== targetLang) {
                                targetLang = newLang
                                resetTranslationState()
                                processAllLines()
                                console.log(LOG, 'Language changed to:', targetLang)
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(LOG, 'Error loading language setting', e)
        }
    }

    async function pollSettings() {
        await loadLanguageSetting()
    }

    // ------------------ Запуск ------------------
    const observer = new MutationObserver(() => debounceProcess())
    observer.observe(document.body, { childList: true, subtree: true })

    loadLanguageSetting().then(() => {
        processAllLines()
    })
    setInterval(pollSettings, 2500)
})()