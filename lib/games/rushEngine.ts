// lib/games/rushEngine.ts - ENDLESS NEON RUSH ENGINE
// Pattern same as ludoEngine, carromEngine, arrowEngine

import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export const RUSH_CONFIG = {
  PLAYER_SIZE: 28,
  OB_SIZE: 32,
  OB_MIN_GAP: 18,
  BASE_SPEED: 6,
  SPEED_INC: 0.18, // har 10 score pe speed badhegi
  MAX_SPEED: 18,
  SPAWN_RATE: 0.22, // obstacle spawn chance
  SAFE_ZONE: 140, // player area
  COLORS: ['#FF0080', '#00F5FF', '#FFD93D', '#7C3AED', '#2FBF71'] as const,
};

export type RushObstacle = {
  id: number;
  x: number;
  y: number;
  color: typeof RUSH_CONFIG.COLORS[number];
  size: number;
  speed: number;
  type: 'block' | 'spike' | 'laser';
};

export type RushState = {
  playerX: number;
  obstacles: RushObstacle[];
  score: number;
  best: number;
  speed: number;
  isGameOver: boolean;
  isPaused: boolean;
  combo: number; // kitne obstacle bina mare nikale
};

export type RushAction = 
  | { type: 'MOVE'; x: number }
  | { type: 'TICK' }
  | { type: 'RESET'; best: number }
  | { type: 'GAME_OVER' };

// Initial State
export function createInitialState(best = 0): RushState {
  return {
    playerX: width / 2 - RUSH_CONFIG.PLAYER_SIZE / 2,
    obstacles: [],
    score: 0,
    best,
    speed: RUSH_CONFIG.BASE_SPEED,
    isGameOver: false,
    isPaused: false,
    combo: 0,
  };
}

// Speed calculation based on score - ENDLESS scaling
export function getSpeedForScore(score: number): number {
  const level = Math.floor(score / 100);
  return Math.min(
    RUSH_CONFIG.BASE_SPEED + level * RUSH_CONFIG.SPEED_INC,
    RUSH_CONFIG.MAX_SPEED
  );
}

// Spawn new obstacle with random logic
let _idCounter = 0;
export function spawnObstacle(score: number): RushObstacle {
  const speedVariation = (Math.random() - 0.5) * 2;
  const speed = getSpeedForScore(score) + speedVariation;
  
  // Hard mode me alag type
  const isHard = score > 500;
  const typeRoll = Math.random();
  let type: RushObstacle['type'] = 'block';
  if (isHard && typeRoll > 0.7) type = 'spike';
  if (isHard && typeRoll > 0.9) type = 'laser';

  const size = type === 'laser' ? RUSH_CONFIG.OB_SIZE * 1.5 : RUSH_CONFIG.OB_SIZE + (Math.random() * 8 - 4);

  return {
    id: _idCounter++,
    x: Math.random() * (width - size),
    y: -size,
    color: RUSH_CONFIG.COLORS[Math.floor(Math.random() * RUSH_CONFIG.COLORS.length)],
    size,
    speed,
    type,
  };
}

// Collision detection - pixel perfect
export function checkCollision(playerX: number, obstacles: RushObstacle[]): RushObstacle | null {
  const playerLeft = playerX;
  const playerRight = playerX + RUSH_CONFIG.PLAYER_SIZE;
  const playerTop = height - RUSH_CONFIG.SAFE_ZONE - 20;
  const playerBottom = playerTop + RUSH_CONFIG.PLAYER_SIZE;

  for (const ob of obstacles) {
    const obLeft = ob.x;
    const obRight = ob.x + ob.size;
    const obTop = ob.y;
    const obBottom = ob.y + ob.size;

    // AABB collision
    if (
      obBottom > playerTop &&
      obTop < playerBottom &&
      obRight > playerLeft + 4 &&
      obLeft < playerRight - 4
    ) {
      // For spike, smaller hitbox
      if (ob.type === 'spike') {
        const centerDist = Math.abs((ob.x + ob.size/2) - (playerX + RUSH_CONFIG.PLAYER_SIZE/2));
        if (centerDist < 16) return ob;
      } else {
        return ob;
      }
    }
  }
  return null;
}

// Main reducer - same as other engines
export function rushReducer(state: RushState, action: RushAction): RushState {
  switch (action.type) {
    case 'MOVE': {
      if (state.isGameOver) return state;
      const clamped = Math.max(0, Math.min(width - RUSH_CONFIG.PLAYER_SIZE, action.x));
      return { ...state, playerX: clamped };
    }

    case 'TICK': {
      if (state.isGameOver || state.isPaused) return state;

      const speed = getSpeedForScore(state.score);
      
      // Move obstacles
      let nextObs = state.obstacles
        .map(o => ({ ...o, y: o.y + o.speed }))
        .filter(o => o.y < height + 50);

      // Spawn logic - endless
      if (Math.random() < RUSH_CONFIG.SPAWN_RATE + state.score * 0.0001) {
        // Check gap from last obstacle
        const last = nextObs[nextObs.length - 1];
        if (!last || last.y > RUSH_CONFIG.OB_MIN_GAP) {
          nextObs.push(spawnObstacle(state.score));
        }
        // Double spawn in hard mode
        if (state.score > 800 && Math.random() < 0.3) {
          nextObs.push(spawnObstacle(state.score));
        }
      }

      // Check collision
      const hit = checkCollision(state.playerX, nextObs);
      if (hit) {
        return { ...state, obstacles: nextObs, isGameOver: true, best: Math.max(state.best, state.score), combo: 0 };
      }

      // Count passed obstacles for combo
      const passed = state.obstacles.length - nextObs.length;
      
      return {
        ...state,
        obstacles: nextObs,
        score: state.score + 1,
        speed,
        combo: passed > 0 ? state.combo + passed : state.combo,
      };
    }

    case 'GAME_OVER':
      return { ...state, isGameOver: true, best: Math.max(state.best, state.score) };

    case 'RESET':
      return createInitialState(action.best);

    default:
      return state;
  }
}

// Helper for SFX - integrates with your sfx.ts
export const RUSH_SFX = {
  MOVE: 'tap',
  DODGE: 'rush_coin',
  COMBO: 'stack_perfect',
  CRASH: 'rush_over',
  PERFECT_DODGE: 'stack_perfect',
} as const;

// Difficulty label
export function getDifficultyLabel(score: number): string {
  if (score < 200) return 'EASY';
  if (score < 500) return 'MEDIUM';
  if (score < 1000) return 'HARD';
  if (score < 2000) return 'INSANE';
  return 'NIGHTMARE';
}
