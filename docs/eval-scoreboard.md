# Eval Scoreboard

Automatically updated by `npm run eval-compare`.

## Results

| Date       | Label                     | Model            | Server Model                    | Set                 | Questions | Pass Rate | Passed | Total | Git SHA | Diff Hash | Settings |
|------------|---------------------------|------------------|---------------------------------|---------------------|-----------|-----------|--------|-------|---------|-----------|----------|
| 2026-03-04 | baseline                  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 54     | 54    | b3ccae1 |           |          |
| 2026-03-04 | baseline                  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 63.6%     | 21     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 60.6%     | 20     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 72.7%     | 24     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 96.3%     | 52     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 69.7%     | 23     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-sms-params          | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation      | 4         | 100.0%    | 20     | 20    | 1fff5d2 | 14f28890  |          |
| 2026-03-04 | before-desc-reorder       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 97.8%     | 88     | 90    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 67.3%     | 37     | 55    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 60.0%     | 6      | 10    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 80.0%     | 4      | 5     | 33ab0b9 |           | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 97.8%     | 88     | 90    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 58.2%     | 32     | 55    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 60.0%     | 6      | 10    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 20.0%     | 11     | 55    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 70.0%     | 7      | 10    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 60.0%     | 54     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 72.7%     | 40     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 100.0%    | 10     | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 80.0%     | 4      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 65.5%     | 36     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 90.0%     | 9      | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 78.2%     | 43     | 55    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 80.0%     | 8      | 10    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | context             | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | core                | 1         | 0.0%      | 0      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | dataset-attributes  | 1         | 0.0%      | 0      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | dataset-copy-rename | 2         | 100.0%    | 4      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | datasets            | 5         | 0.0%      | 0      | 10    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | description-quality | 11        | 87.3%     | 96     | 110   | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | jobs                | 4         | 75.0%     | 3      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | mutations           | 2         | 70.0%     | 7      | 10    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | naming-stress       | 18        | 92.2%     | 166    | 180   | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | pagination          | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | read-pagination     | 1         | 50.0%     | 1      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | restore-dataset     | 1         | 100.0%    | 1      | 1     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | search-pagination   | 1         | 50.0%     | 1      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | search              | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | sms-allocation      | 4         | 100.0%    | 20     | 20    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | tso                 | 3         | 66.7%     | 4      | 6     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | uss-copy            | 3         | 100.0%    | 6      | 6     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash | gemini-2.5-flash                | uss                 | 4         | 87.5%     | 7      | 8     | 991e458 |           |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | context             | 2         | 100.0%    | 4      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | core                | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | dataset-attributes  | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | dataset-copy-rename | 2         | 75.0%     | 3      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | datasets            | 5         | 100.0%    | 10     | 10    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | description-quality | 11        | 94.5%     | 104    | 110   | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | jobs                | 4         | 100.0%    | 4      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | mutations           | 2         | 100.0%    | 10     | 10    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | naming-stress       | 18        | 97.8%     | 176    | 180   | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | pagination          | 2         | 25.0%     | 1      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | read-pagination     | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | restore-dataset     | 1         | 100.0%    | 1      | 1     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | search-pagination   | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | search              | 2         | 50.0%     | 2      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | sms-allocation      | 4         | 100.0%    | 20     | 20    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | tso                 | 3         | 83.3%     | 5      | 6     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | uss-copy            | 3         | 100.0%    | 6      | 6     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash   | gemini-3-flash-preview          | uss                 | 4         | 87.5%     | 7      | 8     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | context             | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | core                | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-attributes  | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-copy-rename | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | datasets            | 5         | 100.0%    | 10     | 10    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality | 11        | 92.7%     | 102    | 110   | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | jobs                | 4         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | mutations           | 2         | 100.0%    | 10     | 10    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress       | 18        | 100.0%    | 180    | 180   | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | pagination          | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | read-pagination     | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | restore-dataset     | 1         | 100.0%    | 1      | 1     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination   | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | search              | 2         | 75.0%     | 3      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation      | 4         | 100.0%    | 20     | 20    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | tso                 | 3         | 83.3%     | 5      | 6     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | uss-copy            | 3         | 100.0%    | 6      | 6     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3            | Qwen3-30B-A3B-Thinking-2507-FP8 | uss                 | 4         | 87.5%     | 7      | 8     | 9ddfe9e | 9ee5e0c8  |          |
