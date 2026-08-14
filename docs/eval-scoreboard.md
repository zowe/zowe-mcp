# Eval Scoreboard

Automatically updated by `npm run eval-compare`.

## Results

| Date       | Label                     | Model                 | Server Model                    | Set                      | Questions | Pass Rate | Passed | Total | Git SHA | Diff Hash | Settings |
|------------|---------------------------|-----------------------|---------------------------------|--------------------------|-----------|-----------|--------|-------|---------|-----------|----------|
| 2026-03-04 | baseline                  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 54     | 54    | b3ccae1 |           |          |
| 2026-03-04 | baseline                  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 63.6%     | 21     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-rename-searchString | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 60.6%     | 20     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 94.4%     | 51     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-param-descriptions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 72.7%     | 24     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 96.3%     | 52     | 54    | b3ccae1 |           |          |
| 2026-03-04 | after-search-desc-reorder | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 69.7%     | 23     | 33    | b3ccae1 |           |          |
| 2026-03-04 | after-sms-params          | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation           | 4         | 100.0%    | 20     | 20    | 1fff5d2 | 14f28890  |          |
| 2026-03-04 | before-desc-reorder       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 97.8%     | 88     | 90    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 67.3%     | 37     | 55    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 60.0%     | 6      | 10    | 33ab0b9 |           | reps=5   |
| 2026-03-04 | before-desc-reorder       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 80.0%     | 4      | 5     | 33ab0b9 |           | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 97.8%     | 88     | 90    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 58.2%     | 32     | 55    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 60.0%     | 6      | 10    | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | after-desc-reorder        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 31961799  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 90     | 90    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 20.0%     | 11     | 55    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 70.0%     | 7      | 10    | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 5      | 5     | 33ab0b9 | eafe1d59  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 60.0%     | 54     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 72.7%     | 40     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 100.0%    | 10     | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-04 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 80.0%     | 4      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 65.5%     | 36     | 55    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 90.0%     | 9      | 10    | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | with-server-instructions  | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 0dedacdf  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 78.2%     | 43     | 55    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 90     | 90    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 80.0%     | 8      | 10    | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | after-desc-improvements   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 5      | 5     | 33ab0b9 | 836449c8  | reps=5   |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | context                  | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | core                     | 1         | 0.0%      | 0      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | dataset-attributes       | 1         | 0.0%      | 0      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | dataset-copy-rename      | 2         | 100.0%    | 4      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | datasets                 | 5         | 0.0%      | 0      | 10    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | description-quality      | 11        | 87.3%     | 96     | 110   | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | jobs                     | 4         | 75.0%     | 3      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | mutations                | 2         | 70.0%     | 7      | 10    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | naming-stress            | 18        | 92.2%     | 166    | 180   | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | pagination               | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | read-pagination          | 1         | 50.0%     | 1      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | restore-dataset          | 1         | 100.0%    | 1      | 1     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | search-pagination        | 1         | 50.0%     | 1      | 2     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | search                   | 2         | 50.0%     | 2      | 4     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | sms-allocation           | 4         | 100.0%    | 20     | 20    | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | tso                      | 3         | 66.7%     | 4      | 6     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | uss-copy                 | 3         | 100.0%    | 6      | 6     | 991e458 |           |          |
| 2026-03-05 | gemini-baseline           | gemini-2.5-flash      | gemini-2.5-flash                | uss                      | 4         | 87.5%     | 7      | 8     | 991e458 |           |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | context                  | 2         | 100.0%    | 4      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | core                     | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | dataset-attributes       | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | dataset-copy-rename      | 2         | 75.0%     | 3      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | datasets                 | 5         | 100.0%    | 10     | 10    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | description-quality      | 11        | 94.5%     | 104    | 110   | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | jobs                     | 4         | 100.0%    | 4      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | mutations                | 2         | 100.0%    | 10     | 10    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | naming-stress            | 18        | 97.8%     | 176    | 180   | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | pagination               | 2         | 25.0%     | 1      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | read-pagination          | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | restore-dataset          | 1         | 100.0%    | 1      | 1     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | search-pagination        | 1         | 100.0%    | 2      | 2     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | search                   | 2         | 50.0%     | 2      | 4     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | sms-allocation           | 4         | 100.0%    | 20     | 20    | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | tso                      | 3         | 83.3%     | 5      | 6     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | uss-copy                 | 3         | 100.0%    | 6      | 6     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | gemini-3-flash-baseline   | gemini-3-flash        | gemini-3-flash-preview          | uss                      | 4         | 87.5%     | 7      | 8     | 991e458 | 28d77b6d  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | context                  | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | core                     | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-attributes       | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-copy-rename      | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | datasets                 | 5         | 100.0%    | 10     | 10    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 92.7%     | 102    | 110   | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | jobs                     | 4         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | mutations                | 2         | 100.0%    | 10     | 10    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 180    | 180   | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | pagination               | 2         | 100.0%    | 4      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | read-pagination          | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | restore-dataset          | 1         | 100.0%    | 1      | 1     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 2      | 2     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 75.0%     | 3      | 4     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation           | 4         | 100.0%    | 20     | 20    | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | tso                      | 3         | 83.3%     | 5      | 6     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | uss-copy                 | 3         | 100.0%    | 6      | 6     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-05 | qwen3-full-baseline       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | uss                      | 4         | 87.5%     | 7      | 8     | 9ddfe9e | 9ee5e0c8  |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | context                  | 2         | 50.0%     | 2      | 4     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | core                     | 1         | 100.0%    | 2      | 2     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | dataset-attributes       | 1         | 100.0%    | 2      | 2     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | dataset-copy-rename      | 2         | 100.0%    | 4      | 4     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | datasets                 | 5         | 70.0%     | 7      | 10    | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | description-quality      | 11        | 94.5%     | 104    | 110   | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | detail-levels            | 4         | 100.0%    | 20     | 20    | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | jobs                     | 4         | 100.0%    | 4      | 4     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | mutations                | 2         | 100.0%    | 10     | 10    | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | naming-stress            | 18        | 100.0%    | 180    | 180   | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | pagination               | 2         | 25.0%     | 1      | 4     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | read-pagination          | 1         | 100.0%    | 2      | 2     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | restore-dataset          | 1         | 100.0%    | 1      | 1     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | search-pagination        | 1         | 100.0%    | 2      | 2     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | search                   | 2         | 50.0%     | 2      | 4     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | sms-allocation           | 4         | 100.0%    | 20     | 20    | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | tso                      | 3         | 100.0%    | 6      | 6     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | uss-copy                 | 3         | 100.0%    | 6      | 6     | 0fefa64 |           |          |
| 2026-03-07 | gemini-3-flash-all        | gemini-3-flash        | gemini-3-flash-preview          | uss                      | 4         | 100.0%    | 8      | 8     | 0fefa64 |           |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | context                  | 2         | 100.0%    | 4      | 4     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | core                     | 1         | 100.0%    | 2      | 2     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | dataset-attributes       | 1         | 100.0%    | 2      | 2     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | dataset-copy-rename      | 2         | 100.0%    | 4      | 4     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | datasets                 | 5         | 100.0%    | 10     | 10    | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | description-quality      | 11        | 97.3%     | 107    | 110   | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | detail-levels            | 4         | 100.0%    | 20     | 20    | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | jobs                     | 4         | 100.0%    | 4      | 4     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | mutations                | 2         | 100.0%    | 10     | 10    | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | naming-stress            | 18        | 98.3%     | 177    | 180   | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | pagination               | 2         | 100.0%    | 4      | 4     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | read-pagination          | 1         | 100.0%    | 2      | 2     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | restore-dataset          | 1         | 100.0%    | 1      | 1     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | search-pagination        | 1         | 50.0%     | 1      | 2     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | search                   | 2         | 75.0%     | 3      | 4     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | sms-allocation           | 4         | 100.0%    | 20     | 20    | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | tso                      | 3         | 100.0%    | 6      | 6     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | uss-copy                 | 3         | 100.0%    | 6      | 6     | 79f2287 | c1ed4994  |          |
| 2026-03-07 | after-assertion-fixes     | gemini-3-flash        | gemini-3-flash-preview          | uss                      | 4         | 100.0%    | 8      | 8     | 79f2287 | c1ed4994  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | datasets                 | 5         | 100.0%    | 10     | 10    | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | description-quality      | 11        | 92.7%     | 102    | 110   | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | search                   | 2         | 100.0%    | 4      | 4     | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | naming-stress            | 18        | 98.9%     | 178    | 180   | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | search-pagination        | 1         | 50.0%     | 1      | 2     | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | dataset-attributes       | 1         | 100.0%    | 2      | 2     | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | sms-allocation           | 4         | 100.0%    | 20     | 20    | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | after-validDsn            | gemini-3-flash        | gemini-3-flash-preview          | pagination               | 2         | 100.0%    | 4      | 4     | 79f2287 | 7ef1ed03  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | context                  | 2         | 100.0%    | 4      | 4     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | core                     | 1         | 100.0%    | 2      | 2     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-attributes       | 1         | 100.0%    | 2      | 2     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | dataset-copy-rename      | 2         | 100.0%    | 4      | 4     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | datasets                 | 5         | 100.0%    | 10     | 10    | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 96.4%     | 106    | 110   | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | detail-levels            | 4         | 90.0%     | 18     | 20    | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | jobs                     | 4         | 100.0%    | 4      | 4     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | mutations                | 2         | 90.0%     | 9      | 10    | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 99.4%     | 179    | 180   | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | pagination               | 2         | 100.0%    | 4      | 4     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | read-pagination          | 1         | 50.0%     | 1      | 2     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | restore-dataset          | 1         | 100.0%    | 1      | 1     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search-pagination        | 1         | 100.0%    | 2      | 2     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | search                   | 2         | 100.0%    | 4      | 4     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | sms-allocation           | 4         | 100.0%    | 20     | 20    | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | tso                      | 3         | 100.0%    | 6      | 6     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | uss-copy                 | 3         | 100.0%    | 6      | 6     | bdddfbc | aca3ccec  |          |
| 2026-03-08 | qwen3-all-validDsn        | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | uss                      | 4         | 100.0%    | 8      | 8     | bdddfbc | aca3ccec  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor                  | 10        | 98.0%     | 49     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-cli              | 10        | 100.0%    | 50     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-optimized        | 10        | 100.0%    | 50     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-code4z           | 10        | 90.0%     | 45     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-stress           | 10        | 58.0%     | 29     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-stress-cli       | 10        | 66.0%     | 33     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-stress-optimized | 10        | 70.0%     | 35     | 50    | 65786fa | e213b704  |          |
| 2026-03-25 | variants-comparison       | gemini-2.5-flash      | gemini-2.5-flash                | endevor-stress-code4z    | 10        | 70.0%     | 35     | 50    | 65786fa | e213b704  |          |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-next      | qwen/qwen3-coder-next           | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-next      | qwen/qwen3-coder-next           | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-next      | qwen/qwen3-coder-next           | datasets                 | 5         | 91.0%     | 91     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-30b       | qwen/qwen3-coder-30b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-30b       | qwen/qwen3-coder-30b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-coder-30b       | qwen/qwen3-coder-30b            | datasets                 | 5         | 87.0%     | 87     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen2.5-coder-14b     | qwen/qwen2.5-coder-14b          | core                     | 1         | 95.0%     | 19     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen2.5-coder-14b     | qwen/qwen2.5-coder-14b          | context                  | 2         | 90.0%     | 36     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen2.5-coder-14b     | qwen/qwen2.5-coder-14b          | datasets                 | 5         | 89.0%     | 89     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | devstral-small-2-2512 | mistralai/devstral-small-2-2512 | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | devstral-small-2-2512 | mistralai/devstral-small-2-2512 | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | devstral-small-2-2512 | mistralai/devstral-small-2-2512 | datasets                 | 5         | 40.0%     | 40     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | minimax-m2.7          | minimax/minimax-m2.7            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | minimax-m2.7          | minimax/minimax-m2.7            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | minimax-m2.7          | minimax/minimax-m2.7            | datasets                 | 5         | 99.0%     | 99     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | datasets                 | 5         | 100.0%    | 100    | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-next-80b        | qwen/qwen3-next-80b             | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-next-80b        | qwen/qwen3-next-80b             | context                  | 2         | 97.5%     | 39     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | qwen3-next-80b        | qwen/qwen3-next-80b             | datasets                 | 5         | 80.0%     | 80     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | glm-4.7-flash         | zai-org/glm-4.7-flash           | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | glm-4.7-flash         | zai-org/glm-4.7-flash           | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | glm-4.7-flash         | zai-org/glm-4.7-flash           | datasets                 | 5         | 94.0%     | 94     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | granite-4-h-tiny      | ibm/granite-4-h-tiny            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | granite-4-h-tiny      | ibm/granite-4-h-tiny            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | smoke-lmstudio-top10      | granite-4-h-tiny      | ibm/granite-4-h-tiny            | datasets                 | 5         | 68.0%     | 68     | 100   | d47ccfe | 7f13bec4  | reps=20  |
| 2026-05-14 | kimi-k2-followup          | kimi-k2-instruct      | kimi-k2-instruct                | core                     | 1         | 85.0%     | 17     | 20    | d47ccfe | 9c4937bd  | reps=20  |
| 2026-05-14 | kimi-k2-followup          | kimi-k2-instruct      | kimi-k2-instruct                | context                  | 2         | 77.5%     | 31     | 40    | d47ccfe | 9c4937bd  | reps=20  |
| 2026-05-14 | kimi-k2-followup          | kimi-k2-instruct      | kimi-k2-instruct                | datasets                 | 5         | 72.0%     | 72     | 100   | d47ccfe | 9c4937bd  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | datasets                 | 5         | 100.0%    | 100    | 100   | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3-coder-30b       | qwen/qwen3-coder-30b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3-coder-30b       | qwen/qwen3-coder-30b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | qwen3-coder-30b       | qwen/qwen3-coder-30b            | datasets                 | 5         | 94.0%     | 94     | 100   | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | glm-4.7-flash         | zai-org/glm-4.7-flash           | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | glm-4.7-flash         | zai-org/glm-4.7-flash           | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | tier12-plus-granite41     | glm-4.7-flash         | zai-org/glm-4.7-flash           | datasets                 | 5         | 86.0%     | 86     | 100   | d47ccfe | b09e0e68  | reps=20  |
| 2026-05-15 | granite-4.1-30b-followup  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 6dd789d8  | reps=20  |
| 2026-05-15 | granite-4.1-30b-followup  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 6dd789d8  | reps=20  |
| 2026-05-15 | granite-4.1-30b-followup  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | datasets                 | 5         | 80.0%     | 80     | 100   | d47ccfe | 6dd789d8  | reps=20  |
| 2026-05-15 | minimax-m2.7-followup     | minimax-m2.7          | minimax/minimax-m2.7            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 9ba4b4ef  | reps=20  |
| 2026-05-15 | minimax-m2.7-followup     | minimax-m2.7          | minimax/minimax-m2.7            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 9ba4b4ef  | reps=20  |
| 2026-05-15 | minimax-m2.7-followup     | minimax-m2.7          | minimax/minimax-m2.7            | datasets                 | 5         | 97.0%     | 97     | 100   | d47ccfe | 9ba4b4ef  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | dataset-copy-rename      | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | datasets                 | 5         | 82.0%     | 82     | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | description-quality      | 11        | 87.7%     | 193    | 220   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | detail-levels            | 4         | 100.0%    | 80     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | local-files              | 5         | 60.0%     | 60     | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | mutations                | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | naming-stress            | 18        | 83.3%     | 300    | 360   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | pagination               | 2         | 45.0%     | 18     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | read-pagination          | 1         | 85.0%     | 17     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | search-pagination        | 1         | 10.0%     | 2      | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | sms-allocation           | 4         | 0.0%      | 0      | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | tso                      | 3         | 33.3%     | 20     | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | uss                      | 4         | 75.0%     | 60     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | uss-copy                 | 3         | 0.0%      | 0      | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | dataset-copy-rename      | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | datasets                 | 5         | 100.0%    | 100    | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | description-quality      | 11        | 99.1%     | 218    | 220   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | detail-levels            | 4         | 100.0%    | 80     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | local-files              | 5         | 59.0%     | 59     | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | mutations                | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | naming-stress            | 18        | 83.3%     | 300    | 360   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | pagination               | 2         | 67.5%     | 27     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | read-pagination          | 1         | 35.0%     | 7      | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | search-pagination        | 1         | 0.0%      | 0      | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | sms-allocation           | 4         | 0.0%      | 0      | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | tso                      | 3         | 33.3%     | 20     | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | uss                      | 4         | 75.0%     | 60     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | uss-copy                 | 3         | 0.0%      | 0      | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | dataset-copy-rename      | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | datasets                 | 5         | 99.0%     | 99     | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | description-quality      | 11        | 99.1%     | 218    | 220   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | detail-levels            | 4         | 95.0%     | 76     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | local-files              | 5         | 56.0%     | 56     | 100   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | mutations                | 2         | 0.0%      | 0      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | naming-stress            | 18        | 82.2%     | 296    | 360   | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | pagination               | 2         | 17.5%     | 7      | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | read-pagination          | 1         | 80.0%     | 16     | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | search-pagination        | 1         | 30.0%     | 6      | 20    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | sms-allocation           | 4         | 0.0%      | 0      | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | tso                      | 3         | 33.3%     | 20     | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | uss                      | 4         | 75.0%     | 60     | 80    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-15 | full-top3-mock            | minimax-m2.7          | minimax/minimax-m2.7            | uss-copy                 | 3         | 0.0%      | 0      | 60    | d47ccfe | cf2cb72c  | reps=20  |
| 2026-05-16 | qwen3.6-27b-smoke         | qwen3.6-27b           | qwen_qwen3.6-27b                | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 0c7c0097  | reps=20  |
| 2026-05-16 | qwen3.6-27b-smoke         | qwen3.6-27b           | qwen_qwen3.6-27b                | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 0c7c0097  | reps=20  |
| 2026-05-16 | qwen3.6-27b-smoke         | qwen3.6-27b           | qwen_qwen3.6-27b                | datasets                 | 5         | 100.0%    | 100    | 100   | d47ccfe | 0c7c0097  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | dataset-copy-rename      | 2         | 67.5%     | 27     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | datasets                 | 5         | 80.0%     | 80     | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | description-quality      | 11        | 85.9%     | 189    | 220   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | detail-levels            | 4         | 87.5%     | 70     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | local-files              | 5         | 100.0%    | 100    | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | mutations                | 2         | 77.5%     | 31     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | naming-stress            | 18        | 96.7%     | 348    | 360   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | pagination               | 2         | 27.5%     | 11     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | read-pagination          | 1         | 95.0%     | 19     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | search-pagination        | 1         | 15.0%     | 3      | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | sms-allocation           | 4         | 96.3%     | 77     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | tso                      | 3         | 46.7%     | 28     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | uss                      | 4         | 73.8%     | 59     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | granite-4.1-30b       | ibm-granite_granite-4.1-30b     | uss-copy                 | 3         | 100.0%    | 60     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | dataset-copy-rename      | 2         | 95.0%     | 38     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | datasets                 | 5         | 100.0%    | 100    | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | description-quality      | 11        | 97.3%     | 214    | 220   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | detail-levels            | 4         | 100.0%    | 80     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | local-files              | 5         | 100.0%    | 100    | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | mutations                | 2         | 90.0%     | 36     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | naming-stress            | 18        | 100.0%    | 360    | 360   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | pagination               | 2         | 27.5%     | 11     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | read-pagination          | 1         | 80.0%     | 16     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | search-pagination        | 1         | 0.0%      | 0      | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | sms-allocation           | 4         | 100.0%    | 80     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | tso                      | 3         | 68.3%     | 41     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | uss                      | 4         | 81.3%     | 65     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | uss-copy                 | 3         | 100.0%    | 60     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | core                     | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | context                  | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | dataset-attributes       | 1         | 100.0%    | 20     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | dataset-copy-rename      | 2         | 70.0%     | 28     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | datasets                 | 5         | 99.0%     | 99     | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | description-quality      | 11        | 96.4%     | 212    | 220   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | detail-levels            | 4         | 93.8%     | 75     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | local-files              | 5         | 99.0%     | 99     | 100   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | mutations                | 2         | 72.5%     | 29     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | naming-stress            | 18        | 99.7%     | 359    | 360   | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | pagination               | 2         | 32.5%     | 13     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | read-pagination          | 1         | 90.0%     | 18     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | search-pagination        | 1         | 55.0%     | 11     | 20    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | search                   | 2         | 100.0%    | 40     | 40    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | sms-allocation           | 4         | 100.0%    | 80     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | tso                      | 3         | 65.0%     | 39     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | uss                      | 4         | 86.3%     | 69     | 80    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-17 | full-top3-mock-tier-full  | minimax-m2.7          | minimax/minimax-m2.7            | uss-copy                 | 3         | 100.0%    | 60     | 60    | d47ccfe | 6a545b02  | reps=20  |
| 2026-05-30 | post-dedup-refactor       | gemini-2.5-flash      | gemini-2.5-flash                | naming-stress            | 18        | 63.9%     | 115    | 180   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | gemini-2.5-flash      | gemini-2.5-flash                | description-quality      | 11        | 65.5%     | 72     | 110   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 180    | 180   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 96.4%     | 106    | 110   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | gemini-2.5-flash      | gemini-2.5-flash                | naming-stress            | 18        | 76.7%     | 138    | 180   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | gemini-2.5-flash      | gemini-2.5-flash                | description-quality      | 11        | 80.9%     | 89     | 110   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 180    | 180   | bde1e95 |           |          |
| 2026-05-30 | post-dedup-refactor       | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 94.5%     | 104    | 110   | bde1e95 |           |          |
| 2026-05-30 | top3-local-remote-cloud   | lm-qwen3-8b           | broadcom/qwen3-8b               | naming-stress            | 18        | 6.7%      | 6      | 90    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-05-30 | top3-local-remote-cloud   | lm-qwen3-8b           | broadcom/qwen3-8b               | description-quality      | 11        | 0.0%      | 0      | 55    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-05-30 | top3-local-remote-cloud   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | naming-stress            | 18        | 100.0%    | 90     | 90    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-05-30 | top3-local-remote-cloud   | qwen3                 | Qwen3-30B-A3B-Thinking-2507-FP8 | description-quality      | 11        | 100.0%    | 55     | 55    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-05-30 | top3-local-remote-cloud   | gemini-2.5-flash      | gemini-2.5-flash                | naming-stress            | 18        | 73.3%     | 66     | 90    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-05-30 | top3-local-remote-cloud   | gemini-2.5-flash      | gemini-2.5-flash                | description-quality      | 11        | 83.6%     | 46     | 55    | bde1e95 | 7abe4ebf  | reps=5   |
| 2026-07-31 | baseline                  | gemini-2.5-flash      | gemini-2.5-flash                | system                   | 6         | 70.0%     | 21     | 30    | 3d7caa4 |           |          |
| 2026-07-31 | baseline                  | gemini-2.5-flash      | gemini-2.5-flash                | certificates             | 12        | 70.0%     | 42     | 60    | 3d7caa4 |           |          |
| 2026-07-31 | after-system-certs        | gemini-2.5-flash      | gemini-2.5-flash                | naming-stress            | 18        | 87.8%     | 158    | 180   | 3d7caa4 | 6fbf5f33  |          |
| 2026-07-31 | after-system-certs        | gemini-2.5-flash      | gemini-2.5-flash                | description-quality      | 11        | 83.6%     | 92     | 110   | 3d7caa4 | 6fbf5f33  |          |
| 2026-08-03 | rebaseline-empty-retry    | gemini-2.5-flash      | gemini-2.5-flash                | system                   | 11        | 94.5%     | 52     | 55    | ef42148 | 0bf7403b  |          |
| 2026-08-03 | rebaseline-empty-retry    | gemini-2.5-flash      | gemini-2.5-flash                | certificates             | 13        | 93.8%     | 61     | 65    | ef42148 | 0bf7403b  |          |
| 2026-08-06 | v7-merge-qwen-baseline    | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | system                   | 11        | 100.0%    | 55     | 55    | b0a14fd |           |          |
| 2026-08-06 | v7-merge-qwen-baseline    | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | certificates             | 13        | 100.0%    | 65     | 65    | b0a14fd |           |          |
| 2026-08-06 | v7-merge-qwen-baseline    | qwen3.6-35b-a3b       | qwen/qwen3.6-35b-a3b            | multi-turn               | 4         | 100.0%    | 20     | 20    | b0a14fd |           |          |
