# Editorial photography notes

The homepage lead still life at `public/images/editorial-still-life.webp` is an original AI-generated image created specifically for this repository and optimized to WebP (~142 KB). It is artwork, not a documentary photograph.


OFFSCRIPT's starter stories use real photographs served from the Unsplash image CDN. These are linked directly with responsive widths so the browser can request an appropriate image size. A local SVG cover remains available for each editorial department as a fallback, and the service worker can cache viewed photography for offline revisits.

Photo set (direct image sources; current story photography continues to load from the Unsplash CDN):

- [Art and culture](https://images.unsplash.com/photo-1513364776144-60967b0f800f)
- [Lived-in spaces](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0)
- [Food and the table](https://images.unsplash.com/photo-1540189549336-e6e99c3679fe)
- [Personal style](https://images.unsplash.com/photo-1529139574466-a303027c1d8b)
- [Open landscapes](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b)
- [Books and creative practice](https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85)
- [Weekend outdoors](https://images.unsplash.com/photo-1500530855697-b586d89ba3ee)
- [Secondhand style](https://images.unsplash.com/photo-1490481651871-ab68de25d43d)
- [Colourful lunch](https://images.unsplash.com/photo-1490645935967-10de6ba17061)
- [Eclectic rooms](https://images.unsplash.com/photo-1513519245088-0e12902e5a38)
- [Writing desk](https://images.unsplash.com/photo-1455390582262-044cdead277a)
- [Flowers in daylight](https://images.unsplash.com/photo-1490750967868-88aa4486c946)
- [Window plants](https://images.unsplash.com/photo-1501004318641-b39e6451bec6)
- [Morning meadow](https://images.unsplash.com/photo-1470252649378-9c29740c9fa8)

The public gallery is subject to the [Unsplash License](https://unsplash.com/license). Editor-entered remote cover URLs are restricted to `images.unsplash.com` and `images.pexels.com`; local `/images/` artwork is preferred for reliable first paint and offline fallbacks. The current Unsplash guidance requires image URLs returned by its API to be hotlinked when an app integrates the Unsplash API; OFFSCRIPT currently uses curated CDN URLs and does not make Unsplash API requests. If you later add live photo search through the Unsplash API, follow their [API documentation](https://unsplash.com/documentation) and [hotlinking guidance](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images).
