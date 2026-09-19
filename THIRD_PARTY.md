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

Review dependency licenses before redistributing a bundled commercial product.
