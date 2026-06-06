/**
 * 1099-NEC e-file XML generation.
 *
 * generate1099NecFile — builds a well-formed XML document containing Form1099NEC records
 * for every is_1099 vendor with total payments >= $600 in the requested calendar year.
 *
 * The XML is suitable for review and submission to the IRS FIRE (Filing Information
 * Returns Electronically) system, but transmission itself is out of scope for this
 * function. Callers are responsible for uploading the resulting file via the IRS FIRE
 * portal at https://fire.irs.gov.
 *
 * XML structure:
 *   <Form1099NECFile>
 *     <TaxYear>YYYY</TaxYear>
 *     <Payer>
 *       <BusinessName>…</BusinessName>
 *     </Payer>
 *     <Form1099NEC> (one per eligible vendor)
 *       <PayerInfo>…</PayerInfo>
 *       <PayeeInfo>…</PayeeInfo>
 *       <NonemployeeCompensation>…</NonemployeeCompensation>
 *     </Form1099NEC>
 *   </Form1099NECFile>
 */
import { getCompany } from '@/lib/services/company';
import { vendor1099Report } from '@/lib/services/statements';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';

/** Escape XML special characters in a string value. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap text in a tag, applying XML escaping. Omits the element if value is null/undefined. */
function tag(name: string, value: string | null | undefined): string {
  if (value == null || value === '') return `<${name}/>`;
  return `<${name}>${escapeXml(value)}</${name}>`;
}

export interface Generate1099NecFileOptions {
  /** 4-digit calendar year, e.g. 2025. */
  year: number;
}

/**
 * Generate a 1099-NEC XML e-file string for all eligible vendors in the given year.
 *
 * Uses vendor1099Report to identify eligible payees (is_1099 = true, total >= $600).
 * Payer details are pulled from the active company record.
 *
 * Returns the XML as a UTF-8 string. To submit, upload this file to the IRS FIRE system
 * at https://fire.irs.gov using your TCC (Transmitter Control Code).
 *
 * @throws {ServiceError} VALIDATION — if year is out of range.
 * @throws {ServiceError} NOT_FOUND  — if the company record is missing.
 */
export async function generate1099NecFile(
  ctx: ServiceContext,
  { year }: Generate1099NecFileOptions,
): Promise<string> {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new ServiceError('VALIDATION', `Invalid year: ${year}`);
  }

  // Resolve payer info from the company record.
  const company = await getCompany(ctx);
  if (!company) {
    throw new ServiceError('NOT_FOUND', 'Company not found');
  }

  // Pull eligible vendors via the shared 1099 report logic.
  const vendors = await vendor1099Report(ctx, { year });

  // Build the XML document.
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!-- 1099-NEC e-file data file for IRS FIRE submission -->');
  lines.push('<!-- IMPORTANT: Transmission to IRS FIRE is external. Upload this file via https://fire.irs.gov -->');
  lines.push('<Form1099NECFile>');
  lines.push(`  ${tag('TaxYear', String(year))}`);
  lines.push(`  ${tag('GeneratedAt', new Date().toISOString())}`);

  // Payer block
  lines.push('  <Payer>');
  lines.push(`    ${tag('BusinessName', company.name)}`);
  lines.push('  </Payer>');

  // One Form1099NEC record per eligible vendor
  for (const vendor of vendors) {
    lines.push('  <Form1099NEC>');

    // Payer info (duplicated per record to make each element self-contained)
    lines.push('    <PayerInfo>');
    lines.push(`      ${tag('BusinessName', company.name)}`);
    lines.push('    </PayerInfo>');

    // Payee info
    lines.push('    <PayeeInfo>');
    lines.push(`      ${tag('Name', vendor.vendorName)}`);
    lines.push(`      ${tag('TaxId', vendor.taxId)}`);
    lines.push('    </PayeeInfo>');

    // Box 1 — Nonemployee compensation
    lines.push(`    ${tag('NonemployeeCompensation', vendor.total)}`);

    lines.push('  </Form1099NEC>');
  }

  lines.push('</Form1099NECFile>');

  return lines.join('\n');
}
