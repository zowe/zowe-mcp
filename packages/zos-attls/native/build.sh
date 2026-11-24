#!/bin/sh
#
# This program and the accompanying materials are made available under the terms of the
# Eclipse Public License v2.0 which accompanies this distribution, and is available at
# https://www.eclipse.org/legal/epl-v20.html
#
# SPDX-License-Identifier: EPL-2.0
#
# Copyright Contributors to the Zowe Project.
#
# Manual node-gyp-equivalent build of the zos-attls addon for z/OS (the target
# LPARs have no GNU make, and z/OS /bin/make rejects node-gyp's Makefiles).
# The flag set is copied from the gyp-generated Release flags validated for
# node-racf on Host-A (docs/zos-saf-idp.md, "Building node-racf for Node 24").
#
# Usage: sh build.sh          (from anywhere; builds next to this script)
# Env overrides:
#   NODEDIR   IBM Node SDK root (include/node + lib/libnode.x)
#   NAPI_INC  node-addon-api directory (napi.h)
#   OPENXL    IBM Open XL C/C++ bin directory (ibm-clang++64)
#
# The SIOCTTLSCTL query ioctl is unprivileged (no PROGRAM class, no
# clean-address-space requirement for the query itself). BUT if the addon is
# loaded into a process that also uses node-racf/__passwd (the SAF IdP), it
# must be program-controlled or z/OS kills the process on load:
#   extattr +p build/Release/attls.node     # re-run after every rebuild
# (needs READ on BPX.FILEATTR.PROGCTL). Standalone use needs nothing.
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
NODEDIR=${NODEDIR:-/u/users/group/product/nodejs-zos/v24r0/IBM/node-v24.18.1-os390-s390x-202608141439}
NAPI_INC=${NAPI_INC:-$DIR/../node_modules/node-addon-api}
if [ ! -f "$NAPI_INC/napi.h" ]; then
  # Fall back to the node-addon-api copy from the validated racf build.
  NAPI_INC=/u/users/group/product/usera/zmcp/racf-test/node_modules/node-addon-api
fi
OPENXL=${OPENXL:-/usr/lpp/IBM/cnw/v2r2/openxl/bin}
export PATH=$OPENXL:$PATH

DEFS="-DNODE_GYP_MODULE_NAME=attls -DUSING_UV_SHARED=1 -DUSING_V8_SHARED=1 \
 -DV8_DEPRECATION_WARNINGS=1 -D_GLIBCXX_USE_CXX11_ABI=1 -D_FILE_OFFSET_BITS=64 \
 -D_ALL_SOURCE -DMAP_FAILED=-1 -D_UNIX03_SOURCE -D_LARGEFILE_SOURCE \
 -D__STDC_FORMAT_MACROS -DOPENSSL_THREADS -DOPENSSL_NO_ASM -DZOSLIB_OVERRIDE_CLIB \
 -DZOSLIB_ALIGNED_NEWDEL -D_XOPEN_SOURCE_EXTENDED -D_XOPEN_SOURCE=600 \
 -D_UNIX03_THREADS -D_UNIX03_WITHDRAWN -D_OPEN_SYS_SOCK_IPV6 -D_OPEN_SYS_FILE_EXT=1 \
 -D_POSIX_C_SOURCE=200809L -D_POSIX_SOURCE -D_OPEN_SYS -D_OPEN_SYS_IF_EXT \
 -D_OPEN_MSGQ_EXT -D_LARGE_TIME_API -D_AE_BIMODAL=1 -D_EXT \
 -DNODE_PLATFORM=\"os390\" -DPATH_MAX=1024 -D_ENHANCED_ASCII_EXT=0xFFFFFFFF \
 -DNAPI_DISABLE_CPP_EXCEPTIONS -DBUILDING_NODE_EXTENSION"
INCS="-I$NODEDIR/include/node -I$NODEDIR/include/node/zoslib \
 -I$NODEDIR/include/node/zoslib/include-wrappers/c++ -I$NAPI_INC"
CFLAGS="-m64 -Wall -Wextra -Wno-unused-parameter -fPIC -fno-short-enums \
 -fno-xl-pragma-pack -fstack-protector -fvisibility=default \
 -fzos-le-char-mode=ascii -march=z13 -mzos-target=zosv2r5 -O3 -fno-omit-frame-pointer"
CXXFLAGS="-fno-rtti -fno-exceptions -fno-strict-aliasing -std=gnu++20"

mkdir -p "$DIR/build/Release"
ibm-clang++64 -c "$DIR/attls.cc" -o "$DIR/build/attls.o" $DEFS $INCS $CFLAGS $CXXFLAGS
ibm-clang++64 -shared -m64 -fPIC -o "$DIR/build/Release/attls.node" \
  "$DIR/build/attls.o" "$NODEDIR/lib/libnode.x"
ls -l "$DIR/build/Release/attls.node"
echo BUILD_OK
