# hackernews.lol — calibration report

Generated 2026-04-28T02:14:46.536Z. Compared 18 pairs across distributional and stylistic metrics derivable from text alone.

## Aggregate (pooled across all comments)

| metric | real HN | hackernews.lol | ratio | verdict |
|---|---:|---:|---:|:---:|
| comments (count) | 2258 | 330 | 0.15 | ✗ |
| comment length — median chars | 215 | 323 | 1.50 | ⚠ |
| comment length — p10 | 52 | 251 | 4.83 | ✗ |
| comment length — p90 | 676 | 931 | 1.38 | ✓ |
| comment length — stddev | 340 | 289 | 0.85 | ✓ |
| top-comment length — median | 246 | 338 | 1.37 | ✓ |
| top-comment length — p90 | 777 | 973 | 1.25 | ✓ |
| quote-prefix rate | 0.071 | 0.042 | 0.59 | ⚠ |
| code-block rate | 0.008 | 0.009 | 1.21 | ✓ |
| URLs per comment | 0.120 | 0.033 | 0.28 | ⚠ |
| hedges per 1000 words | 3.64 | 3.08 | 0.85 | ✓ |
| em-dashes per comment | 0.023 | 0.000 | 0.00 | ✗ |

## Per-thread comparison

Verdict legend: ✓ within ±40% · ⚠ within ±80% · ✗ off by more

| hn_id | story_type | real n / top / depth | ours n / top / depth | real top-len p50/p90 | ours top-len p50/p90 | hedges r/o | quote% r/o |
|---|---|---|---|---|---|---|---|
| 47816629 | show_hn | 53/22/4 | 16/5/2 | 372/586 | 406/858 | 1.2/1.1 | 0.04/0.19 |
| 47822940 | ask_hn | 144/67/6 | 23/7/2 | 331/1111 | 306/1577 | 3.0/5.6 | 0.07/0.04 |
| 47823460 | show_hn | 62/19/7 | 18/5/2 | 123/311 | 286/863 | 4.2/1.6 | 0.03/0.00 |
| 47824943 | blog_technical | 121/62/6 | 20/6/2 | 147/375 | 665/1033 | 5.5/2.5 | 0.05/0.05 |
| 47834213 | ask_hn | 156/69/7 | 22/7/3 | 353/1152 | 709/1198 | 4.6/3.1 | 0.10/0.00 |
| 47835411 | show_hn | 74/27/7 | 20/6/2 | 253/806 | 793/1147 | 4.9/1.7 | 0.03/0.05 |
| 47846718 | research | 5/4/1 | 14/4/2 | 186/203 | 320/555 | 0.0/3.0 | 0.00/0.07 |
| 47847558 | show_hn | 105/31/7 | 14/4/2 | 248/522 | 353/570 | 5.2/2.1 | 0.05/0.00 |
| 47849097 | show_hn | 72/20/6 | 13/4/2 | 246/592 | 273/299 | 1.6/1.7 | 0.01/0.00 |
| 47857461 | tell_hn | 184/57/6 | 30/7/2 | 256/774 | 495/1635 | 3.5/4.6 | 0.04/0.03 |
| 47865661 | blog_technical | 64/13/4 | 18/5/2 | 306/719 | 369/562 | 2.9/7.9 | 0.11/0.06 |
| 47865868 | news | 526/84/10 | 19/6/2 | 193/707 | 448/645 | 3.1/1.4 | 0.07/0.00 |
| 47866697 | news | 160/21/10 | 22/7/2 | 188/537 | 338/806 | 3.4/3.3 | 0.14/0.09 |
| 47866750 | blog_technical | 120/34/6 | 16/5/2 | 278/749 | 279/843 | 3.6/0.0 | 0.07/0.00 |
| 47866913 | blog_technical | 195/41/7 | 17/5/2 | 318/838 | 266/440 | 4.6/3.3 | 0.09/0.06 |
| 47868867 | news | 134/28/6 | 17/4/2 | 234/598 | 319/973 | 4.3/2.8 | 0.07/0.06 |
| 47871817 | blog_technical | 11/1/5 | 17/5/2 | 293/293 | 325/1384 | 8.3/1.6 | 0.09/0.00 |
| 47872324 | blog_technical | 72/26/5 | 14/4/2 | 194/782 | 306/317 | 1.6/3.0 | 0.08/0.07 |

## Worst-gap metrics

- **em-dashes per comment** — real 0.023, ours 0.000 (0.00× real)
- **comment-count ratio** — real 2258.000, ours 330.000 (0.15× real)
- **URLs per comment** — real 0.120, ours 0.033 (0.28× real)
- **code-block rate** — real 0.008, ours 0.009 (1.21× real)
- **hedges per 1K words** — real 3.645, ours 3.084 (0.85× real)
