# Bilingual UI implementation

Approved scope: browser-language default, remembered Simplified Chinese / English switch, platform-owned UI and private access screens. Uploaded documents remain unchanged. Mark removal is implemented as removal of Hostlet brand text in platform screens; file-type and access indicators remain available.

1. Add a shared pure translation catalog and frontend language store, with guarded localStorage access and document language updates.
2. Translate all administrator screens, accessible labels, notices, validation errors, and relative dates without resetting forms or sessions on language changes.
3. Localize platform-owned private and missing-page screens using an explicit query preference and Accept-Language fallback; preserve preference during login.
4. Verify translation fallback and language selection, run API tests and production build, then exercise language switching, reload persistence, errors, upload/edit and mobile layout in the browser.
