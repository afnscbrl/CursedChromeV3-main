'use strict';

(async () => {
    try {
        const { CC_LS_DATA } = await chrome.storage.session.get('CC_LS_DATA');
        if (!CC_LS_DATA) return;
        const entries = CC_LS_DATA[location.origin];
        if (!entries || !Object.keys(entries).length) return;
        for (const [key, value] of Object.entries(entries)) {
            localStorage.setItem(key, value);
        }
        console.log(`[Cookie Sync] Injected ${Object.keys(entries).length} localStorage entries for ${location.origin}`);
    } catch {}
})();
