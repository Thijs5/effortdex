// Augments `HTMLElementTagNameMap` so `document.createElement('ev-bar')`,
// `querySelector('ev-summary')` etc. return the concrete component class
// instead of a bare `HTMLElement` — which is what lets a parent set the
// typed `.value` / `.items` / `.evs` properties without a cast.
//
// One entry per registered custom element. Add a line here when a
// component is converted to `.ts`; the `import type` only resolves once
// the target file exists as `.ts`.

import type { EvBar } from './atoms/ev-bar.ts';
import type { GameBall } from './atoms/game-ball.ts';
import type { LevelInput } from './atoms/level-input.ts';
import type { DsItemButton } from './atoms/ds-item-button.ts';
import type { ItemButtonGrid } from './atoms/item-button-grid.ts';
import type { EvSummary } from './molecules/ev-summary.ts';
import type { EvTrainingGuide } from './molecules/ev-training-guide.ts';
import type { GameVersionPicker } from './molecules/game-version-picker.ts';
import type { EvolutionChain } from './organisms/evolution-chain.ts';
import type { TransferPanel } from './organisms/transfer-panel.ts';
import type { ImportReview } from './organisms/import-review.ts';
import type { PokemonSearch } from './organisms/pokemon-search.ts';
import type { EvHistoryLog } from './organisms/ev-history-log.ts';
import type { PokemonDetail } from './organisms/pokemon-detail.ts';
import type { NatureDialog } from './pages/parties/pokemon/nature.ts';
import type { LevelDialog } from './pages/parties/pokemon/level.ts';
import type { IvDialog } from './pages/parties/pokemon/ivs.ts';
import type { ItemsDialog } from './pages/parties/pokemon/items.ts';
import type { CompetitiveDialog } from './pages/parties/pokemon/competitive.ts';
import type { TrainingGuideDialog } from './pages/parties/pokemon/training-guide.ts';

declare global {
  interface HTMLElementTagNameMap {
    'ev-bar': EvBar;
    'game-ball': GameBall;
    'level-input': LevelInput;
    'ds-item-button': DsItemButton;
    'item-button-grid': ItemButtonGrid;
    'ev-summary': EvSummary;
    'ev-training-guide': EvTrainingGuide;
    'game-version-picker': GameVersionPicker;
    'evolution-chain': EvolutionChain;
    'transfer-panel': TransferPanel;
    'import-review': ImportReview;
    'pokemon-search': PokemonSearch;
    'ev-history-log': EvHistoryLog;
    'pokemon-detail': PokemonDetail;
    'nature-dialog': NatureDialog;
    'level-up-dialog': LevelDialog;
    'iv-dialog': IvDialog;
    'items-dialog': ItemsDialog;
    'competitive-dialog': CompetitiveDialog;
    'training-guide-dialog': TrainingGuideDialog;
  }
}
