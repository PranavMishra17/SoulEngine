import { CoreAnchor, NPCDefinition } from '../types/npc.js';
import { createLogger } from '../logger.js';

const logger = createLogger('anchor-guard');

export function validateAnchorIntegrity(original: CoreAnchor, current: CoreAnchor): boolean {
  if (original.backstory !== current.backstory) {
    logger.warn({ field: 'backstory' }, 'Anchor integrity violation: backstory modified');
    return false;
  }

  if (original.principles.length !== current.principles.length) {
    logger.warn({ field: 'principles', originalLength: original.principles.length, currentLength: current.principles.length }, 'Anchor integrity violation: principles length changed');
    return false;
  }

  for (let i = 0; i < original.principles.length; i++) {
    if (original.principles[i] !== current.principles[i]) {
      logger.warn({ field: 'principles', index: i }, 'Anchor integrity violation: principle modified');
      return false;
    }
  }

  return true;
}

export function enforceAnchorImmutability(definition: NPCDefinition, originalAnchor: CoreAnchor): NPCDefinition {
  const isValid = validateAnchorIntegrity(originalAnchor, definition.core_anchor);
  
  if (!isValid) {
    logger.warn('Enforcing anchor immutability: restoring original anchor');
    return {
      ...definition,
      core_anchor: originalAnchor,
    };
  }

  return definition;
}

