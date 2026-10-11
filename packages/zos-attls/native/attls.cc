/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

/*
 * zos-attls native addon: query the AT-TLS security state of a connected TCP
 * socket via the SIOCTTLSCTL ioctl with TTLS_QUERY_ONLY (see
 * docs/zos-attls-aware-mode.md § 2-3).
 *
 * The query is unprivileged: no extattr +p, no PROGRAM class, no clean
 * address space — any process that owns the socket may ask. It never changes
 * connection state (query-only; `ApplicationControlled Off` in the policy
 * blocks only control requests).
 *
 * Error contract: query(fd) never throws for an insecure connection — that is
 * a status in the result. It throws an Error with `code` (errno name) and
 * numeric `errno` when the ioctl itself fails (ENOTCONN, EPROTOTYPE,
 * EWOULDBLOCK, ...), and ENOSYS when built or invoked off z/OS.
 */

#include <napi.h>

/* No C++ std-lib types: the LPAR's C++ runtime DLL (CRTEQCXS) predates the
   Open XL 2.2 libc++ headers and lacks symbols like __hash_memory that
   std::string instantiations pull in (observed on Host-A: CEE3561S at addon
   load). Plain char buffers avoid the dependency entirely. */
#include <cerrno>
#include <cstdio>
#include <cstring>

#ifdef __MVS__
#include <sys/ioctl.h>
#include <sys/types.h>
#include <unistd.h> /* __e2a_l */

#include <ezbztlsc.h> /* SIOCTTLSCTL + struct TTLS_IOCTL (real header, no replication) */
#endif

namespace {

const char* ErrnoName(int err) {
  /* if-chain, not switch: EWOULDBLOCK and EAGAIN may share a value */
  if (err == EWOULDBLOCK) return "EWOULDBLOCK";
  if (err == EAGAIN) return "EAGAIN";
  if (err == ENOTCONN) return "ENOTCONN";
  if (err == EPROTOTYPE) return "EPROTOTYPE";
  if (err == EINVAL) return "EINVAL";
  if (err == EBADF) return "EBADF";
  if (err == EPERM) return "EPERM";
  if (err == EACCES) return "EACCES";
  if (err == ENOBUFS) return "ENOBUFS";
  if (err == EPIPE) return "EPIPE";
  if (err == ECONNRESET) return "ECONNRESET";
  if (err == ENOSYS) return "ENOSYS";
  return "EUNKNOWN";
}

Napi::Value ThrowErrno(Napi::Env env, int err, const char* what) {
  char msg[256];
  snprintf(msg, sizeof(msg), "%s failed: %s (errno %d)", what, strerror(err), err);
  Napi::Error error = Napi::Error::New(env, msg);
  error.Set("code", Napi::String::New(env, ErrnoName(err)));
  error.Set("errno", Napi::Number::New(env, err));
  error.ThrowAsJavaScriptException();
  return env.Undefined();
}

#ifdef __MVS__

const char* PolicyStatusName(unsigned status) {
  switch (status) {
    case TTLS_POL_OFF:
      return "off";
    case TTLS_POL_NO_POLICY:
      return "noPolicy";
    case TTLS_POL_NOT_ENABLED:
      return "notEnabled";
    case TTLS_POL_ENABLED:
      return "enabled";
    case TTLS_POL_APPLCNTRL:
      return "applControlled";
    default:
      return "unknown";
  }
}

const char* ConnStatusName(unsigned status) {
  switch (status) {
    case TTLS_CONN_NOTSECURE:
      return "notSecure";
    case TTLS_CONN_HS_INPROGRESS:
      return "handshakeInProgress";
    case TTLS_CONN_SECURE:
      return "secure";
    default:
      return "unknown";
  }
}

const char* SecurityTypeName(unsigned type) {
  switch (type) {
    case TTLS_SEC_CLIENT:
      return "client";
    case TTLS_SEC_SERVER:
      return "server";
    case TTLS_SEC_SRV_CA_PASS:
      return "serverClientAuthPassThru";
    case TTLS_SEC_SRV_CA_FULL:
      return "serverClientAuthFull";
    case TTLS_SEC_SRV_CA_REQD:
      return "serverClientAuthRequired";
    case TTLS_SEC_SRV_CA_SAFCHK:
      return "serverClientAuthSAFCheck";
    default:
      return "unknown";
  }
}

const char* ProtocolName(unsigned prot) {
  switch (prot) {
    case TTLS_PROT_SSLV2:
      return "SSLv2";
    case TTLS_PROT_SSLV3:
      return "SSLv3";
    case TTLS_PROT_TLSV1:
      return "TLSv1";
    case TTLS_PROT_TLSV1_1:
      return "TLSv1.1";
    case TTLS_PROT_TLSV1_2:
      return "TLSv1.2";
    case TTLS_PROT_TLSV1_3:
      return "TLSv1.3";
    default:
      return nullptr; /* caller reports the raw code */
  }
}

/*
 * The stack fills character fields in EBCDIC (IBM-1047); this addon is
 * compiled ASCII (-fzos-le-char-mode=ascii), so convert a copy with __e2a_l
 * and trim trailing blanks/NULs into `out` (NUL-terminated). Returns the
 * trimmed length — 0 for an all-blank field.
 */
size_t EbcdicField(const char* field, size_t len, char* out, size_t outSize) {
  if (len >= outSize) len = outSize - 1;
  memcpy(out, field, len);
  out[len] = '\0';
  __e2a_l(out, len);
  size_t end = len;
  while (end > 0 && (out[end - 1] == ' ' || out[end - 1] == '\0')) end--;
  out[end] = '\0';
  return end;
}

Napi::Value Query(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "query(fd): fd must be a number").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int fd = info[0].As<Napi::Number>().Int32Value();

  struct TTLS_IOCTL ioc;
  memset(&ioc, 0, sizeof(ioc));
  ioc.TTLSi_Ver = TTLS_VERSION1; /* VERSION2 only needed for quadruplet gets */
  ioc.TTLSi_Req_Type = TTLS_QUERY_ONLY;

  if (ioctl(fd, SIOCTTLSCTL, (char*)&ioc) < 0) {
    return ThrowErrno(env, errno, "SIOCTTLSCTL query");
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("policyStatus", PolicyStatusName(ioc.TTLSi_Stat_Policy));
  result.Set("connStatus", ConnStatusName(ioc.TTLSi_Stat_Conn));

  if (ioc.TTLSi_Stat_Conn == TTLS_CONN_SECURE) {
    unsigned prot = ioc.TTLSi_SSL_Prot;
    result.Set("protocolCode", Napi::Number::New(env, prot));
    const char* protName = ProtocolName(prot);
    if (protName != nullptr) {
      result.Set("protocol", protName);
    } else {
      char hex[16];
      snprintf(hex, sizeof(hex), "0x%04x", prot);
      result.Set("protocol", hex);
    }

    /* Prefer the 4-char cipher field; the 2-char one reads "4X" when the
       4-char applies and duplicates it otherwise. */
    char cipher[8];
    size_t cipherLen = EbcdicField(ioc.TTLSi_Neg_Cipher4, sizeof(ioc.TTLSi_Neg_Cipher4), cipher,
                                   sizeof(cipher));
    if (cipherLen == 0) {
      cipherLen =
          EbcdicField(ioc.TTLSi_Neg_Cipher, sizeof(ioc.TTLSi_Neg_Cipher), cipher, sizeof(cipher));
    }
    if (cipherLen > 0) result.Set("cipher", cipher);

    result.Set("fips140", Napi::Number::New(env, ioc.TTLSi_FIPS140));
    result.Set("securityType", SecurityTypeName(ioc.TTLSi_Sec_Type));

    if (ioc.TTLSi_UserID_Len > 0 && ioc.TTLSi_UserID_Len <= sizeof(ioc.TTLSi_UserID)) {
      char userId[16];
      if (EbcdicField(ioc.TTLSi_UserID, ioc.TTLSi_UserID_Len, userId, sizeof(userId)) > 0) {
        result.Set("partnerUserId", userId);
      }
    }
  }

  return result;
}

#else /* !__MVS__ */

Napi::Value Query(const Napi::CallbackInfo& info) {
  /* Covers a mis-copied binary; the addon only builds on z/OS anyway. */
  return ThrowErrno(info.Env(), ENOSYS, "SIOCTTLSCTL query (not z/OS)");
}

#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("query", Napi::Function::New(env, Query));
  return exports;
}

}  // namespace

NODE_API_MODULE(attls, Init)
