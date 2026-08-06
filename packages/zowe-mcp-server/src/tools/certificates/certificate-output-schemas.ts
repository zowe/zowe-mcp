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

/**
 * MCP output schemas (Zod) for z/OS certificate / key ring tools.
 *
 * Used as outputSchema in registerTool so tools/list advertises the structure
 * and tool results can return validated structuredContent.
 * Reuses the envelope context/result metadata from dataset-output-schemas.
 */

import { z } from 'zod';
import {
  mutationResultMetaSchema,
  sharedEnvelopeSchema,
} from '../datasets/dataset-output-schemas.js';

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

function envelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  resultSchema: z.ZodType | undefined,
  envelopeDescription: string
) {
  return sharedEnvelopeSchema(dataSchema, {
    resultSchema,
    resultDescription: 'Result of a mutation. success is true.',
    description: envelopeDescription,
    messagesDescription:
      'Operational messages (e.g. a non-fatal SAF warning). Omitted when empty.',
  });
}

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

const safReturnCodesSchema = z
  .object({
    functionCode: z
      .number()
      .describe('R_datalib function code (e.g. 0x08 DataPut, 0x09 DataRemove).'),
    safReturnCode: z.number().describe('SAF return code.'),
    productReturnCode: z
      .number()
      .describe('Security product (RACF, ACF2, or Top Secret) return code.'),
    productReasonCode: z
      .number()
      .describe('Security product (RACF, ACF2, or Top Secret) reason code.'),
  })
  .optional()
  .describe('SAF codes behind a warning or error, when a non-zero code was returned.');

const gskReturnCodeSchema = z
  .number()
  .optional()
  .describe('System SSL / GSKCMS status code, when a GSK call failed.');

const warningSchema = z
  .string()
  .optional()
  .describe('Human-readable note for a non-fatal warning, when one occurred.');

// ---------------------------------------------------------------------------
// connectCertificate
// ---------------------------------------------------------------------------

const connectCertificateDataSchema = z.object({
  owner: z.string().describe('Certificate owner (user ID).'),
  keyring: z.string().describe('Target key ring name.'),
  label: z.string().describe('Certificate label.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const connectCertificateOutputSchema = envelopeSchema(
  connectCertificateDataSchema,
  mutationResultMetaSchema,
  'Result of connecting a certificate to a key ring.'
);

// ---------------------------------------------------------------------------
// deleteCertificate
// ---------------------------------------------------------------------------

const deleteCertificateDataSchema = z.object({
  owner: z.string().describe('Certificate owner (user ID).'),
  label: z.string().describe('Certificate label.'),
  keyring: z.string().optional().describe('Key ring the certificate was disconnected from.'),
  database: z
    .boolean()
    .optional()
    .describe('True when the certificate was deleted from the security database.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const deleteCertificateOutputSchema = envelopeSchema(
  deleteCertificateDataSchema,
  mutationResultMetaSchema,
  'Result of disconnecting or deleting a certificate.'
);

// ---------------------------------------------------------------------------
// exportCertificate
// ---------------------------------------------------------------------------

const exportCertificateDataSchema = z.object({
  label: z.string().describe('Certificate label.'),
  owner: z.string().describe('Key ring owner (user ID).'),
  keyring: z.string().describe('Key ring name.'),
  format: z.string().describe('Export format that was produced ("pem" or "p12").'),
  file: z.string().optional().describe('Output file path, when written to disk on z/OS.'),
  bytesWritten: z.number().optional().describe('Number of bytes written to the output file.'),
  content: z
    .string()
    .optional()
    .describe('Exported certificate text (PEM), when not written to a file.'),
});

export const exportCertificateOutputSchema = envelopeSchema(
  exportCertificateDataSchema,
  undefined,
  'Result of exporting a certificate. data has either file/bytesWritten or content, depending on whether file was given.'
);

// ---------------------------------------------------------------------------
// importCertificate
// ---------------------------------------------------------------------------

const importCertificateDataSchema = z.object({
  label: z.string().describe('Certificate label.'),
  owner: z.string().describe('Key ring owner (user ID).'),
  keyring: z.string().describe('Key ring name.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const importCertificateOutputSchema = envelopeSchema(
  importCertificateDataSchema,
  mutationResultMetaSchema,
  'Result of importing a certificate from a PKCS#12 file.'
);

// ---------------------------------------------------------------------------
// showCertificate
// ---------------------------------------------------------------------------

const showCertificateDataSchema = z.object({
  label: z.string().describe('Certificate label.'),
  owner: z.string().describe('Owning user ID.'),
  usage: z.string().describe('Usage: PERSONAL, CERTAUTH, or OTHER.'),
  status: z.string().describe('Trust status: TRUST, HIGHTRUST, NOTRUST, or UNKNOWN.'),
  isDefault: z.boolean().describe("Whether this certificate is the ring's default."),
  keyType: z.number().describe('Private-key type code.'),
  keySize: z.number().describe('Private-key size in bits (0 if no private key).'),
  serialNumber: z.string().optional().describe('Certificate serial number (hex).'),
  notBefore: z.string().optional().describe('Validity start (ISO-8601).'),
  notAfter: z.string().optional().describe('Validity end (ISO-8601).'),
  recordId: z
    .string()
    .optional()
    .describe('Security-database record ID (serial + issuer identifier).'),
});

export const showCertificateOutputSchema = envelopeSchema(
  showCertificateDataSchema,
  undefined,
  'Detailed certificate information (no _result).'
);

// ---------------------------------------------------------------------------
// setDefaultCertificate
// ---------------------------------------------------------------------------

const setDefaultCertificateDataSchema = z.object({
  owner: z.string().describe('Key ring owner (user ID).'),
  keyring: z.string().describe('Key ring name.'),
  label: z.string().describe('Certificate label.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const setDefaultCertificateOutputSchema = envelopeSchema(
  setDefaultCertificateDataSchema,
  mutationResultMetaSchema,
  "Result of setting a certificate as a key ring's default."
);

// ---------------------------------------------------------------------------
// trustCertificate
// ---------------------------------------------------------------------------

const trustCertificateDataSchema = z.object({
  owner: z.string().describe('Certificate owner (user ID).'),
  label: z.string().describe('Certificate label.'),
  status: z.string().describe('New trust status: TRUST, HIGHTRUST, or NOTRUST.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const trustCertificateOutputSchema = envelopeSchema(
  trustCertificateDataSchema,
  mutationResultMetaSchema,
  "Result of changing a certificate's trust status."
);

// ---------------------------------------------------------------------------
// renameCertificate
// ---------------------------------------------------------------------------

const renameCertificateDataSchema = z.object({
  owner: z.string().describe('Certificate owner (user ID).'),
  label: z.string().describe('Previous certificate label.'),
  newLabel: z.string().describe('New certificate label.'),
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const renameCertificateOutputSchema = envelopeSchema(
  renameCertificateDataSchema,
  mutationResultMetaSchema,
  "Result of renaming a certificate's label."
);

// ---------------------------------------------------------------------------
// refreshCertificateClass
// ---------------------------------------------------------------------------

const refreshCertificateClassDataSchema = z.object({
  warning: warningSchema,
  safReturnCodes: safReturnCodesSchema,
  gskReturnCode: gskReturnCodeSchema,
});

export const refreshCertificateClassOutputSchema = envelopeSchema(
  refreshCertificateClassDataSchema,
  mutationResultMetaSchema,
  'Result of refreshing the DIGTCERT class.'
);
