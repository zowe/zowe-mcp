# Search Benchmark Results

**Date**: 2026-03-03
**DSN**: SYS1.PARMLIB
**Search string**: "SYSTEM"
**System**: r152.msd.labs.broadcom.net

## Results

| Metric | ZNP tool.search | Fallback (list+read+grep) |
| --- | --- | --- |
| Wall-clock time | 8527 ms | 124186 ms |
| Lines found | 229 | 229 |
| Lines processed | 66721 | 70061 |
| Members with matches | 42 | 42 |
| Members without matches | 127 | 127 |
| Total members returned | 42 | 42 |
| Pages fetched | 1 | 1 |

## Summary

ZNP tool.search completed in **8527 ms** vs fallback in **124186 ms** (**14.56x** speedup).

ZNP tool.search runs SuperC on z/OS in a single RPC call, while the fallback lists all members, reads each one over SSH, and greps in-process.
