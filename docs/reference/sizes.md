# Sizes

What each stack of this repository weighs: the `.wasm` file of its build for the web, and what a
browser downloads, once gzipped, as GitHub Pages sends it. The extensions are what makes a build
bigger, intl above all (see [Supported extensions](extensions.md)), and what is embedded, as the
`vendor/` of the Symfony example.

<!-- site:build lists the sizes here -->

`castor site:build` measures them when it builds this website. `castor wasm:sizes` gives them for
what you built, and `castor wasm:sizes --json` as JSON.
