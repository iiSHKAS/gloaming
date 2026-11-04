import type {Clip} from '../lib/types';

export interface EdTrack {
  id: string;
  type: 'video' | 'audio' | 'text';
  label: string;
  muted?: boolean;
}

export interface EdTransition {
  fx: string;
  len: number;
}

export interface EdItem {
  id: string;
  kind: 'clip' | 'audio' | 'text';
  trackId: string;
  start: number;
  dur: number;
  clipId?: string;
  offset?: number;
  muted?: boolean;
  audioStream?: number;
  volume?: number;
  groupId?: string;
  audioUnlinked?: boolean;
  trans?: EdTransition;
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  x?: number;
  y?: number;
}

export interface EdProject {
  version: number;
  tracks: EdTrack[];
  items: EdItem[];
  keyboard?: boolean;
  controller?: {enabled: boolean; position: [number, number]};
  /** Where the keyboard panel sits on the picture, 0..1 each way; unset is the bottom-left corner. */
  keyboardPosition?: [number, number];
}

export type EdTab = 'library' | 'effects' | 'text';

/** What the React chrome renders from. Recomputed on every engine change. */
export interface EdSnapshot {
  ready: boolean;
  tab: EdTab;
  query: string;
  playing: boolean;
  playhead: number;
  duration: number;
  pps: number;
  selected: EdItem | null;
  canSplit: boolean;
  canDetach: boolean;
  canRelink: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Set while the daemon is transcoding an H.265 proxy for a clip on stage. */
  preparing: boolean;
  empty: boolean;
}

export interface EditorDeps {
  clips: () => Clip[];
  notify: (title: string, tone?: 'accent' | 'error') => void;
  accent: () => string;
}
