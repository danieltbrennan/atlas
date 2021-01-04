import React from 'react';
import { Runtime, ViewerMode } from '../../../renderer/runtime';
import { Renderer } from '../../../renderer/renderer';
import { RuntimeController } from '../../../types';
import { BaseObject } from '../../../objects/base-object';

export type AtlasContextType = {
  // State
  ready: boolean;
  canvasPosition?: { width: number; height: number; top: number; left: number };
  runtime?: Runtime;
  renderer?: Renderer;
  controller?: RuntimeController;
  viewport: { width: number; height: number; x: number; y: number; scale: number };
  canvas?: React.MutableRefObject<HTMLCanvasElement | undefined>;

  // Mouse states
  lastTouches: Array<{ id: number; x: number; y: number }>;
};

export const AtlasContext = React.createContext<AtlasContextType | undefined>(undefined);