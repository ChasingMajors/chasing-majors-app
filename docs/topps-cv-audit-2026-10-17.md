# Topps checklists vs CV — audit, 2026-10-17

The full [Topps checklist page](https://www.topps.com/pages/checklists) was captured and compared against the current committed CV catalog (1,011 products). This is an audit; no CV records were added, replaced, or deleted.

## Page-wide inventory

- **916 linked checklists** captured, including historical releases.
- **310** match existing CV products using normalized titles or reviewed aliases. A match establishes product presence, not complete content.
- **232** sports-related titles remain unmatched across all years. Older entries need alias and release-scope review before they can be called missing products.
- **374** links fall outside our five-sport catalog or need separate category scoping. These are not counted as sports omissions.

The initial source selection was Topps' current “2026” sections (101 links, which include 2025-26 and some 2025 releases). Page section is not the product year. Seasons and special editions are kept distinct; a product from last year does not satisfy this year's checklist.

## Current sports products absent from CV

The following **14** products remain absent after alias review. Their linked PDFs were downloaded and inspected for readable checklist content. Original files, text extracts, page counts, and SHA-256 hashes are saved alongside this report. This identifies an import queue; it does not publish any unreviewed card data.

| Official title | Checklist |
|---|---|
| 2026 Bowman Chrome® Baseball Sapphire Edition | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Bowman_Chrome_Baseball_Sapphire_Edition_Checklist.pdf?v=1790956155) |
| 2026 Bowman U Best Football | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Bowman_U_Best_FB_Checklist.pdf?v=1791206274) |
| 2026 Topps Chrome® Baseball – Team Samurai Japan Collection | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Chrome_Samurai_Japan_Checklist_update_8.26_1.pdf?v=1787762012) |
| 2026 Topps Chrome® Football | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_26TCFB.pdf?v=1792077449) |
| Topps Chrome® Major League Soccer 2026 | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/CheckList_Subject_to_Change_3ac890e7-2e2f-4550-89d8-59689322cd5c.pdf?v=1789050559) |
| 2026 Topps Cosmic Chrome® Baseball | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Cosmic_Chrome_Baseball_-_Checklist.pdf?v=1790609925) |
| 2026-27 Topps Flagship Basketball | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/Copy_of_2026-27_Topps_Flagship_Basketball_Checklist_10-9-26.xls_-_Compatibility_Mode.pdf?v=1791570579) |
| 2026 Topps Heritage Football | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Heritage_Football_Checklist.pdf?v=1790800436) |
| 2026 Topps Holiday Baseball | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Holiday_Baseball_26THBW_-_Checklist.pdf?v=1789566977) |
| 2026 Topps Inception Football | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Inception_Football_CheckList_26TIFB_VERSION.pdf?v=1790715925) |
| 2025/26 Topps Manchester United Collector Tin | [Official PDF](https://cdn.shopify.com/s/files/1/0739/2015/1805/files/2025-26_Manchester_United_Collector_Tin_Checklist.pdf?v=1758044356) |
| Topps® Manchester United 2025/26 Team Set | [Official PDF](https://cdn.shopify.com/s/files/1/0739/2015/1805/files/Manchester_United_Team_Set_2025-26_Checklist.pdf?v=1770828538) |
| 2026 Topps MLB x KAWS | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/KAWs_Checklist.pdf?v=1784208798) |
| 2026 Topps Museum Collection Baseball | [Official PDF](https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2026_Topps_Museum_Baseball_Checklist.pdf?v=1788204579) |

**First priority: 2026-27 Topps Flagship Basketball**, then upcoming releases and products where PRV already exists without a CV checklist (for example MLB x KAWS, Chrome MLS, and Bowman Chrome Sapphire). The official Flagship PDF has 57 pages and lists the new season; the current CV index contains no 2026-27 product. No old-season product was renamed to cover it.

## Existing CV products with empty checklist data

**11 unique products** have an indexed CV entry but zero card rows and zero parallel rows in their current payload:

- 2024 Bowman University Best Football (`2024-bowman-university-best-football`)
- 2024 Topps Chrome Football (`2024-topps-chrome-football`)
- 2024 Topps Chrome Sapphire Football (`2024-topps-chrome-sapphire-football`)
- 2024 Topps Cosmic Chrome Football (`2024-topps-cosmic-chrome-football`)
- 2024 Topps Finest Football (`2024-topps-finest-football`)
- 2024 Topps Inception Football (`2024-topps-inception-football`)
- 2024 Topps Midnight Football (`2024-topps-midnight-football`)
- 2024 Topps Resurgence Football (`2024-topps-resurgence-football`)
- 2024 Topps Signature Class Football (`2024-topps-signature-class-football`)
- 2024 Bowman University Chrome Football (`2024-bowman-university-chrome-football`)
- 2024 Bowman University Chrome Sapphire Football (`2024-bowman-university-chrome-sapphire-football`)

These are data-content gaps, not new-product discovery gaps. Their presence in search does not mean the checklist is populated.

## Card-level spot audit of already reviewed official subsets

218 official subset snapshots across Bowman Basketball, Finest Basketball, NBA Hoops, Signature Class, Three, Flagship Basketball, and 2026 Flagship Football were compared with CV. Card IDs were compared case-insensitively; multi-signer cards are counted by ID once.

- **185 subsets:** official and CV card-ID sets match under the same normalized subset name.
- **32 subsets:** names/scopes need mapping review. All are Football naming/scope cases, and their reviewed IDs are present somewhere in that product's CV; this is not evidence that those cards are missing. Base variations and grouped scopes require particular care.
- **1 confirmed subset gap:** 2026 Flagship Football **All Kings** has 30 IDs in the official list and 25 in CV. Missing: **AK-26, AK-27, AK-28, AK-29, AK-30**. PRV already displays the official count 30. CV still needs the five actual card records from the official source.

The existing All Kings production estimate was preserved in earlier PRV work. Increasing checklist size alone does not validate that estimate against a revised checklist.

This comparison checks presence of card IDs in these 218 reviewed scopes. It does not certify player/team spelling, every parallel, pack odds, or all subsets in every linked PDF. The remaining page-wide products need their own content-level review.

## Aliases and scope traps resolved

- “Hopps” on Topps' page maps to existing NBA Hoops; it is not a new product.
- Bowman University Best maps to existing Bowman Best U.
- Topps' “2026 Chrome Black Basketball” is indexed in CV as 2025-26. All **150 base card-number/player pairs** match the official PDF. The audit treats this as an existing product, not a duplicate import. Autograph and variation completeness is not inferred from that base check.
- “Definitive” / “Definitive Collection” and “Updates” / “Update Series” are recorded as reviewed aliases.
- **2026 Brooklyn Collection is Captain America/Marvel**, confirmed by the downloaded checklist and [Topps' own product page](https://www.topps.com/products/2026-topps-brooklyn-collection-hobby-box). It is not a missing baseball release or a broken checklist link. Titles alone can misclassify a product's sport.

## Review files

- [catalog-comparison.csv](audits/2026-10-17-topps-cv/catalog-comparison.csv): all 916 title comparisons, exact official links, matched CV codes, and actual payload row counts.
- [catalog-comparison.json](audits/2026-10-17-topps-cv/catalog-comparison.json): includes candidate names for manual alias review. Candidates are suggestions, never automatic matches.
- [official-links.json](audits/2026-10-17-topps-cv/official-links.json): captured page inventory.
- [download-review.json](audits/2026-10-17-topps-cv/download-review.json): hashes and page counts for the 16 current PDFs inspected before alias/scope resolution.
- [reviewed-subset-comparison.json](audits/2026-10-17-topps-cv/reviewed-subset-comparison.json): all 218 subset comparisons and the exact missing IDs.

## Recommended import controls

Before adding each missing product: verify season and product identity from inside the PDF; extract base/insert/autograph/relic scopes separately; retain multi-person cards as one card ID; compare subset ID lists and parallel stamps; publish to the right sport/season shard; verify CV search and the product view live. Keep internal evidence out of public data rows.

The PRV cleanup was published separately as commit `9471516`. This audit does not modify Sentinel, Sheets, or CV source data.
