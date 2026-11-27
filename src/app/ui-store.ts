import { create } from 'zustand';
import type { ScenarioKey } from '../domain/types';

interface UiStore {
  creatorOpen: boolean;
  preset?: ScenarioKey;
  openCreator: (preset?: ScenarioKey) => void;
  closeCreator: () => void;
}
export const useUi = create<UiStore>((set) => ({
  creatorOpen: false,
  openCreator: (preset) => set({ creatorOpen: true, preset }),
  closeCreator: () => set({ creatorOpen: false, preset: undefined }),
}));
