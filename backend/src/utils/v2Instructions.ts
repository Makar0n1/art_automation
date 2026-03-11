/**
 * V2 Instruction Text Builder
 * Assembles the per-generation user directives into a single instruction string
 * for injection into AI prompts.
 *
 * Fields are stored separately in the DB; this helper merges them at call time.
 * Keep structure predictable so prompts can rely on fixed section labels.
 */

export interface V2InstructionContext {
  audience?: string;
  comment?: string;
  mustCover?: string[];
  mustAvoid?: string[];
}

/**
 * Build a unified instruction block from v2 content directives.
 * Returns `undefined` when all inputs are empty (no injection needed).
 */
export function buildV2InstructionText(ctx: V2InstructionContext): string | undefined {
  const lines: string[] = [];

  if (ctx.audience?.trim()) {
    lines.push(`Audience: ${ctx.audience.trim()}`);
  }

  if (ctx.comment?.trim()) {
    lines.push(`Additional instructions: ${ctx.comment.trim()}`);
  }

  if (ctx.mustCover && ctx.mustCover.length > 0) {
    const items = ctx.mustCover.map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      lines.push(`Must cover: ${items.join(', ')}`);
    }
  }

  if (ctx.mustAvoid && ctx.mustAvoid.length > 0) {
    const items = ctx.mustAvoid.map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      lines.push(`Must avoid: ${items.join(', ')}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}
