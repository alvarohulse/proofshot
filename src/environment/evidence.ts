import * as fs from 'fs';
import type { EvidenceEvent } from './types.js';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;

export function normalizeLogText(text: string, stripAnsi = true): string {
  const normalized = text.replace(/\r\n?/g, '\n').replace(CONTROL_PATTERN, '');
  return stripAnsi ? normalized.replace(ANSI_PATTERN, '') : normalized;
}

export function appendEvidenceEvent(filePath: string, event: EvidenceEvent): void {
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
}

export function loadEvidenceEvents(filePath: string): EvidenceEvent[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as EvidenceEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is EvidenceEvent => event !== null);
}
