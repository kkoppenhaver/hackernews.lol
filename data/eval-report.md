# hackernews.lol — calibration report

Generated 2026-04-26T10:56:28.416Z. Compared 17 pairs across distributional and stylistic metrics derivable from text alone.

## Aggregate (pooled across all comments)

| metric | real HN | hackernews.lol | ratio | verdict |
|---|---:|---:|---:|:---:|
| comments (count) | 2114 | 320 | 0.15 | ✗ |
| comment length — median chars | 209 | 576 | 2.76 | ✗ |
| comment length — p10 | 51 | 338 | 6.63 | ✗ |
| comment length — p90 | 646 | 1177 | 1.82 | ✗ |
| comment length — stddev | 332 | 325 | 0.98 | ✓ |
| top-comment length — median | 229 | 637 | 2.78 | ✗ |
| top-comment length — p90 | 709 | 1374 | 1.94 | ✗ |
| quote-prefix rate | 0.071 | 0.059 | 0.83 | ✓ |
| code-block rate | 0.008 | 0.016 | 1.94 | ✗ |
| URLs per comment | 0.119 | 0.041 | 0.34 | ⚠ |
| hedges per 1000 words | 3.71 | 2.55 | 0.69 | ✓ |
| em-dashes per comment | 0.022 | 0.000 | 0.00 | ✗ |

## Per-thread comparison

Verdict legend: ✓ within ±40% · ⚠ within ±80% · ✗ off by more

| hn_id | story_type | real n / top / depth | ours n / top / depth | real top-len p50/p90 | ours top-len p50/p90 | hedges r/o | quote% r/o |
|---|---|---|---|---|---|---|---|
| 47816629 | show_hn | 53/22/4 | 19/6/2 | 372/586 | 567/724 | 1.2/2.4 | 0.04/0.00 |
| 47823460 | show_hn | 62/19/7 | 18/5/2 | 123/311 | 472/684 | 4.2/3.2 | 0.03/0.11 |
| 47824943 | blog_technical | 121/62/6 | 16/5/2 | 147/375 | 899/1336 | 5.5/2.4 | 0.05/0.06 |
| 47834213 | ask_hn | 156/69/7 | 28/8/2 | 353/1152 | 842/1750 | 4.6/4.7 | 0.10/0.00 |
| 47835411 | show_hn | 74/27/7 | 15/5/2 | 253/806 | 717/1426 | 4.9/0.0 | 0.03/0.07 |
| 47846718 | research | 5/4/1 | 21/6/2 | 186/203 | 840/931 | 0.0/2.2 | 0.00/0.10 |
| 47847558 | show_hn | 105/31/7 | 20/6/2 | 248/522 | 416/760 | 5.2/1.2 | 0.05/0.00 |
| 47849097 | show_hn | 72/20/6 | 17/5/3 | 246/592 | 471/702 | 1.6/0.8 | 0.01/0.12 |
| 47857461 | tell_hn | 184/57/6 | 23/5/2 | 256/774 | 771/1667 | 3.5/2.3 | 0.04/0.17 |
| 47865661 | blog_technical | 64/13/4 | 15/5/2 | 306/719 | 751/1617 | 2.9/3.3 | 0.11/0.07 |
| 47865868 | news | 526/84/10 | 14/4/3 | 193/707 | 475/508 | 3.1/0.0 | 0.07/0.00 |
| 47866697 | news | 160/21/10 | 18/5/2 | 188/537 | 1119/1321 | 3.4/1.0 | 0.14/0.06 |
| 47866750 | blog_technical | 120/34/6 | 16/5/2 | 278/749 | 687/1233 | 3.6/2.4 | 0.07/0.00 |
| 47866913 | blog_technical | 195/41/7 | 20/6/2 | 318/838 | 1417/1489 | 4.6/3.4 | 0.09/0.00 |
| 47868867 | news | 134/28/6 | 19/5/2 | 234/598 | 580/765 | 4.3/1.0 | 0.07/0.11 |
| 47871817 | blog_technical | 11/1/5 | 22/7/3 | 293/293 | 695/1048 | 8.3/4.6 | 0.09/0.05 |
| 47872324 | blog_technical | 72/26/5 | 19/6/2 | 194/782 | 766/1218 | 1.6/4.3 | 0.08/0.11 |

## Worst-gap metrics

- **em-dashes per comment** — real 0.022, ours 0.000 (0.00× real)
- **comment-count ratio** — real 2114.000, ours 320.000 (0.15× real)
- **URLs per comment** — real 0.119, ours 0.041 (0.34× real)
- **code-block rate** — real 0.008, ours 0.016 (1.94× real)
- **hedges per 1K words** — real 3.712, ours 2.546 (0.69× real)
