import type { PartKind } from '../types';
import { battery } from './battery';
import { bulb } from './bulb';
import { resistor } from './resistor';
import { switchDef } from './switch';
import type { ComponentDef } from './types';

/** Adding a new part = write one ComponentDef file and register it here. */
export const COMPONENTS: Record<PartKind, ComponentDef> = {
  battery,
  resistor,
  bulb,
  switch: switchDef,
};

export * from './types';
