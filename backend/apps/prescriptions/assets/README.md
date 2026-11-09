# Prescription header assets

ArefRuqaa-Regular.ttf is bundled for offline Arabic Ruqah PDF headers, from
https://github.com/google/fonts/tree/main/ofl/arefruqaa . Its SIL Open Font
License is preserved in ArefRuqaa-OFL.txt. The font is embedded directly in PDFs;
no external font requests occur while rendering.

The official AutoPharm brand board is copied unchanged from
`docs/Logos/AutoPharm logo.png` to `autopharm-logo.png` for self-contained backend
images. CSS clips the dark-on-white wordmark variant using source rectangle
x=1730, y=1110, width=650, height=170 of the 2400x1440 board. No pixels are edited
or logo redrawn. The PDF places this image in the upper-right header margin,
above the Arabic professional details, independently of the private clinic logo.
The Advisor browser preview uses the same original image and display rectangle.
