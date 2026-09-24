# Fonts

Self-hosted copies of Bricolage Grotesque and Figtree, generated from the Google
Fonts CSS with the vietnamese subset dropped. ~210 kB in total.

They are self-hosted rather than linked because the demo runs on a phone hotspot
that may have no internet. A failed Google Fonts request does not error — it
silently falls back to system-ui, which changes every heading and readout.

Both families are licensed under the SIL Open Font License 1.1, which permits
redistribution. Licence text is alongside, per family.

To regenerate, refetch the Google Fonts CSS with a modern browser user-agent
(needed to get woff2 rather than ttf) and download the URLs it returns.
