# Eval Scoreboard

Automatically updated by `npm run eval-compare`.

## Results

| Date       | Label                     | Model | Server Model                    | Set                 | Questions | Pass Rate | Passed | Total | Git SHA | Diff Hash | Settings |
|------------|---------------------------|-------|---------------------------------|---------------------|-----------|-----------|--------|-------|---------|-----------|----------|
| 2026-03-04 | baseline                  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 54     | 54    | b3ccae1 |           |          |
| 2026-03-04 | baseline                  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 63.6%     | 21     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 60.6%     | 20     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 72.7%     | 24     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 96.3%     | 52     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 69.7%     | 23     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-sms-params          | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation      | 4         | 100.0%    | 20     | 20    | 1fff5d2 | 14f28890  |          |
| 2026-03-04 | before-desc-reorder       | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 97.8%     | 88     | 90    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 67.3%     | 37     | 55    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 60.0%     | 6      | 10    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 80.0%     | 4      | 5     | 33ab0b9 |           | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 97.8%     | 88     | 90    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 58.2%     | 32     | 55    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 60.0%     | 6      | 10    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 20.0%     | 11     | 55    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 70.0%     | 7      | 10    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 60.0%     | 54     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 72.7%     | 40     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 100.0%    | 10     | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 80.0%     | 4      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 65.5%     | 36     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 90.0%     | 9      | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 78.2%     | 43     | 55    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 80.0%     | 8      | 10    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 836449c8  | reps=5   |
