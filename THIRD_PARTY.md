# Dependencies and upstream references

This package contains an independently written Python bridge, a local HTML UI,
and small generated PPTX fixtures. It is not an official IguanaTex release.

IguanaTex is authored by Jonathan Le Roux, Zvika Ben-Haim, and Tsung-Ju Chiang.
Its public source was consulted for metadata field names and behavior. It is
not bundled. Upstream uses CC BY 3.0:
https://github.com/Jonathan-LeRoux/IguanaTex

Runtime dependencies are installed separately by pip. Each retains its own
license; the MIT license of bridge code does not relicense dependencies.

- lxml: BSD-style license, https://lxml.de/
- Pillow: HPND license, https://python-pillow.github.io/
- PyMuPDF / MuPDF: AGPL or commercial license, https://pymupdf.readthedocs.io/
- TeX distributions, fonts, and macro packages: their respective licenses.
- Playwright (optional webpage OCR): Apache-2.0, https://playwright.dev/python/
- cryptography (optional Office HTTPS setup): Apache-2.0 / BSD, https://cryptography.io/
- PySide6 Essentials / Qt (optional standalone GUI): LGPLv3 / GPLv3 / commercial terms, https://doc.qt.io/qtforpython-6/licenses.html
- Office.js is loaded from Microsoft's hosted CDN, not bundled. See https://learn.microsoft.com/en-us/office/dev/add-ins/overview/office-add-ins

DeepSeek is a third-party web service. Website automation uses the user's own
browser session and account, and is not an official DeepSeek integration.

Review dependency licenses before redistributing a bundled commercial product.
