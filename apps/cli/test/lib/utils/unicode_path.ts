import fs from 'fs';
import path from 'path';

/** Exercise a real obstruction, using a decomposed alias only when the host aliases it. */
export function unicodeObstructionPath(root: string): string {
  const probe = path.join(root, 'unicode-probe-é');
  fs.writeFileSync(probe, 'probe');
  const aliases = fs.existsSync(probe.normalize('NFD'));
  fs.unlinkSync(probe);
  return aliases ? 'café.txt'.normalize('NFD') : 'café.txt';
}
