import type { PartKind } from '../types';
import { battery } from './battery';
import { bulb } from './bulb';
import { capacitor } from './capacitor';
import { diode } from './diode';
import { led } from './led';
import { npn } from './npn';
import { resistor } from './resistor';
import { switchDef } from './switch';
import type { ComponentDef } from './types';

/** Adding a new part = write one ComponentDef file and register it here. */
export const COMPONENTS: Record<PartKind, ComponentDef> = {
  battery,
  resistor,
  bulb,
  switch: switchDef,
  led,
  diode,
  capacitor,
  npn,
};

/** Toolbar order. */
export const PART_ORDER: PartKind[] = ['battery', 'resistor', 'bulb', 'switch', 'led', 'diode', 'capacitor', 'npn'];

export * from './types';
