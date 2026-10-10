#!/bin/sh
# Build zowex-launcher with IBM Open XL C/C++ on z/OS.
# Override the compiler path with IBM_CLANG if the install differs.
set -e
cd "$(dirname "$0")"

IBM_CLANG="${IBM_CLANG:-/usr/lpp/IBM/cnw/v2r2/openxl/bin/ibm-clang64}"
if [ ! -x "$IBM_CLANG" ]; then
  echo "error: compiler not found at $IBM_CLANG (set IBM_CLANG)" >&2
  exit 1
fi

"$IBM_CLANG" -o zowex-launcher zowex-launcher.c
echo "built ./zowex-launcher"
echo "next steps:"
echo "  extattr +p zowex-launcher    # needs READ on BPX.FILEATTR.PROGCTL"
echo "  chmod 700 zowex-launcher"
echo "  ./test.sh <target-userid> [denied-userid]"
