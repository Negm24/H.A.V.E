# AutoPharm corporate homepage

Run `node frontend/corporate/serve.mjs` from the repository root and open http://127.0.0.1:5177/ or http://127.0.0.1:5177/ar/.

Build with `node frontend/corporate/build.mjs`. Generated English and Arabic pages are in ignored `dist/`. Run `node --test frontend/corporate/site.test.mjs` for static checks. No dependency installation is needed for these commands.

The source was brought forward from the corporate feature branch, with the preview branch’s single WebGL renderer, pointer/keyboard rotation and mobile label fixes. The current default build uses the consolidated preview stylesheet and script. The original classic edition remains available through `--classic`.

The customer introduction uses product facts and an explicitly illustrative category assortment. Each example product belongs to one category. Locations, milestone dates and the customer milestone are illustrative. The contact form only previews the inquiry. Product destinations are deferred and all marketing actions stay on the page.

The walkthrough and mobile-launch milestone use an existing fictional-data Hub home-screen capture from the project’s browser checks. The installation uses the existing kiosk photograph. The collection milestone combines that photograph with a simple CSS customer/pickup illustration.

Verification on 14 November 2026 passed the build, three static tests and JavaScript syntax validation. Edge checks at 1440px and 390px in both languages found no page errors, horizontal overflow or outbound links, and confirmed localized map search and one cabinet renderer. Reduced motion was enabled during these checks. Localhost access from the browser test process timed out, so browser checks fulfilled requests directly from the built static files.

GitHub Pages publishes the generated files from `autopharm-site-preview`. Build that deployment with `node frontend/corporate/build.mjs --base=/H.A.V.E`. The corporate feature branch contains the editable source. Updating that source requires rebuilding and publishing the preview branch to update the public site.
