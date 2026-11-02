import React, { useState, useEffect, useCallback } from 'react';
import { 
  Zap, Activity, MousePointerClick, FastForward, 
  TrendingUp, Clock, Battery, Crosshair, 
  Trophy, Target, Power 
} from 'lucide-react';

// --- CONFIGURATION & CONSTANTS ---
const ITEM_DEFS = {
  synergy: { name: 'Synergy Capacitor', desc: '+15% global multiplier per owned anomaly.', icon: Activity, color: 'text-blue-400' },
  panic: { name: 'Panic Button', desc: 'Passive generation x10 when timer is under 10s.', icon: Zap, color: 'text-yellow-400' },
  heavy: { name: 'Heavy Clicks', desc: 'Manual clicks gain +5% of your total passive/sec.', icon: MousePointerClick, color: 'text-orange-400' },
  overclock: { name: 'Overclocking', desc: 'Passive x4, but Max Timer is reduced by 5s.', icon: FastForward, color: 'text-red-400' },
  compound: { name: 'Compound Interest', desc: '+2% global multiplier for every second spent in current level.', icon: TrendingUp, color: 'text-emerald-400' },
  momentum: { name: 'Momentum', desc: '+1% passive power per click made in the last 2 seconds.', icon: Clock, color: 'text-purple-400' },
  battery: { name: 'Battery Expansion', desc: 'Checkpoint target requirement grows 15% slower.', icon: Battery, color: 'text-green-400' },
  crit: { name: 'Crit Chip', desc: '10% chance for any manual click to generate 10x power.', icon: Crosshair, color: 'text-pink-400' },
};

const getUpgradeCost = (type, level) => {
  const bases = { click: 2, passive: 3, time: 5 };
  return Math.floor(bases[type] * Math.pow(1.5, level));
};

const formatNumber = (num) => {
  if (num === 0) return "0";
  if (num < 1000) return Math.floor(num).toString();
  const suffixes = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc", "Ud", "Dd", "Td"];
  const suffixNum = Math.floor(Math.log10(num) / 3);
  if (suffixNum < suffixes.length) {
    let shortValue = num / Math.pow(10, suffixNum * 3);
    return shortValue.toFixed(2) + suffixes[suffixNum];
  }
  return num.toExponential(2);
};

const formatTime = (time) => Math.max(0, time).toFixed(1) + 's';

// --- MAIN COMPONENT ---
export default function App() {
  // Game States: 'start', 'playing', 'drafting', 'gameover'
  const [gameState, setGameState] = useState('start');
  
  // Meta Meta (Permanent Progression)
  const [metaState, setMetaState] = useState({
    prestigePoints: 0,
    highestLevel: 1,
    upgrades: { click: 0, passive: 0, time: 0 }
  });

  // Current Run State
  const [runState, setRunState] = useState({
    power: 0,
    checkpoint: 100,
    timeRemaining: 30,
    level: 1,
    timeInLevel: 0,
    items: {},
    recentClicks: [],
    // Cached values for UI display
    _currentMaxTime: 30,
    _currentPassive: 0,
    _currentClick: 1,
    _currentMult: 1
  });

  const [draftOptions, setDraftOptions] = useState([]);
  const [pendingPrestige, setPendingPrestige] = useState(0);

  // --- CORE LOGIC & MATH ---
  const calculateStats = useCallback((currentState, meta, activeClicksCount) => {
    let globalMult = 1;
    
    // Synergy Capacitor
    const totalItems = Object.values(currentState.items).reduce((a, b) => a + b, 0);
    if (currentState.items.synergy) globalMult += (totalItems * 0.15 * currentState.items.synergy);
    
    // Compound Interest
    const compoundStacks = Math.floor(currentState.timeInLevel);
    if (currentState.items.compound) globalMult += (compoundStacks * 0.02 * currentState.items.compound);

    // Max Time
    let maxTime = 30 + (meta.upgrades.time * 2);
    if (currentState.items.overclock) maxTime -= (5 * currentState.items.overclock);
    maxTime = Math.max(5, maxTime); // Hard floor

    // Passive Power
    let basePassive = 0 + (meta.upgrades.passive * 2);
    let passive = basePassive;
    
    if (currentState.items.overclock) passive *= Math.pow(4, currentState.items.overclock);
    if (currentState.items.panic && currentState.timeRemaining < 10) passive *= Math.pow(10, currentState.items.panic);
    if (currentState.items.momentum) passive *= (1 + (0.01 * activeClicksCount * currentState.items.momentum));
    
    passive *= globalMult;

    // Click Power
    let click = 1 + (meta.upgrades.click * 1);
    click *= globalMult;
    if (currentState.items.heavy) click += (passive * 0.05 * currentState.items.heavy);

    return { click, passive, maxTime, globalMult };
  }, []);

  // --- GAME LOOP ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const interval = setInterval(() => {
      setRunState(prev => {
        const now = Date.now();
        // Keep clicks within last 2000ms for momentum calculation
        const activeClicks = prev.recentClicks.filter(t => now - t < 2000);
        const stats = calculateStats(prev, metaState, activeClicks.length);
        
        const newPower = prev.power + (stats.passive / 10); // 10 ticks per second
        const newTime = Math.max(0, prev.timeRemaining - 0.1);
        
        return {
          ...prev,
          power: newPower,
          timeRemaining: newTime,
          timeInLevel: prev.timeInLevel + 0.1,
          recentClicks: activeClicks,
          _currentMaxTime: stats.maxTime,
          _currentPassive: stats.passive,
          _currentClick: stats.click,
          _currentMult: stats.globalMult
        };
      });
    }, 100);
    
    return () => clearInterval(interval);
  }, [gameState, metaState, calculateStats]);

  // --- STATE TRIGGERS (Checkpoints & Game Over) ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    if (runState.power >= runState.checkpoint) {
      setGameState('drafting');
      const keys = Object.keys(ITEM_DEFS);
      const shuffled = keys.sort(() => 0.5 - Math.random());
      setDraftOptions(shuffled.slice(0, 3));
    } 
    else if (runState.timeRemaining <= 0) {
      setGameState('gameover');
      // Calculate Prestige based on Level reached
      const gained = Math.floor((runState.level * 2) + Math.pow(runState.level, 1.5));
      setMetaState(prev => ({
          ...prev,
          prestigePoints: prev.prestigePoints + gained,
          highestLevel: Math.max(prev.highestLevel, runState.level)
      }));
      setPendingPrestige(gained);
    }
  }, [runState.power, runState.timeRemaining, runState.checkpoint, runState.level, gameState]);

  // --- ACTIONS ---
  const handleManualClick = useCallback(() => {
    if (gameState !== 'playing') return;
    
    const now = Date.now();
    setRunState(prev => {
      const activeClicks = prev.recentClicks.filter(t => now - t < 2000);
      const stats = calculateStats(prev, metaState, activeClicks.length);
      
      let clickVal = stats.click;
      
      // Crit Chip Logic
      if (prev.items.crit) {
         const critChance = prev.items.crit * 0.10;
         if (Math.random() < critChance) {
             clickVal *= 10;
         }
      }

      return {
        ...prev,
        power: prev.power + clickVal,
        recentClicks: [...prev.recentClicks, now]
      };
    });
  }, [gameState, metaState, calculateStats]);

  const selectDraftItem = (itemId) => {
    setRunState(prev => {
      const newItems = { ...prev, items: { ...prev.items, [itemId]: (prev.items[itemId] || 0) + 1 } };
      
      // Calculate next target scale
      let scale = 3.5;
      if (newItems.items.battery) {
          scale = Math.max(1.5, scale * Math.pow(0.85, newItems.items.battery));
      }
      const nextCheckpoint = prev.checkpoint * scale;
      
      // Determine max time to reset to
      let maxTime = 30 + (metaState.upgrades.time * 2);
      if (newItems.items.overclock) maxTime -= (5 * newItems.items.overclock);
      maxTime = Math.max(5, maxTime);

      return {
        ...prev,
        items: newItems.items,
        level: prev.level + 1,
        checkpoint: nextCheckpoint,
        timeRemaining: maxTime,
        timeInLevel: 0,
        recentClicks: [] // Reset momentum between stages
      };
    });
    setGameState('playing');
  };

  const startRun = () => {
    const initialMaxTime = 30 + (metaState.upgrades.time * 2);
    setRunState({
      power: 0,
      checkpoint: 100,
      timeRemaining: initialMaxTime,
      level: 1,
      timeInLevel: 0,
      items: {},
      recentClicks: [],
      _currentMaxTime: initialMaxTime,
      _currentPassive: metaState.upgrades.passive * 2,
      _currentClick: 1 + metaState.upgrades.click,
      _currentMult: 1
    });
    setGameState('playing');
  };

  const buyUpgrade = (type) => {
    const cost = getUpgradeCost(type, metaState.upgrades[type]);
    if (metaState.prestigePoints >= cost) {
      setMetaState(prev => ({
        ...prev,
        prestigePoints: prev.prestigePoints - cost,
        upgrades: { ...prev.upgrades, [type]: prev.upgrades[type] + 1 }
      }));
    }
  };

  // --- RENDER HELPERS ---
  const UpgradeRow = ({ type, title, desc, icon: Icon }) => {
    const level = metaState.upgrades[type];
    const cost = getUpgradeCost(type, level);
    const canAfford = metaState.prestigePoints >= cost;

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-gray-800 rounded-xl border border-gray-700 gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="p-3 bg-gray-900 rounded-lg">
            <Icon className="text-indigo-400" size={24} />
          </div>
          <div className="text-left">
            <h4 className="font-bold text-white text-lg">{title} <span className="text-indigo-400 text-sm ml-2">Lv.{level}</span></h4>
            <p className="text-gray-400 text-sm">{desc}</p>
          </div>
        </div>
        <button 
          onClick={() => buyUpgrade(type)}
          disabled={!canAfford}
          className={`px-6 py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all w-full sm:w-auto shrink-0 ${
            canAfford ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.5)] hover:scale-105' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          <Trophy size={18} />
          {cost}
        </button>
      </div>
    );
  };

  const progressPercentage = Math.min(100, (runState.power / runState.checkpoint) * 100);
  const isTimerLow = runState.timeRemaining <= 5 && runState.timeRemaining > 0;

  // --- UI RENDER ---
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex flex-col overflow-hidden select-none">
      
      {/* HEADER STATS */}
      <div className="flex flex-wrap justify-between items-center p-4 border-b border-gray-800 bg-gray-900 shadow-md z-10 gap-4">
        <div className="flex gap-6">
          <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg border border-gray-700">
             <Trophy className="text-yellow-400" size={20} />
             <span className="font-bold text-lg">{metaState.prestigePoints}</span>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-lg border border-gray-700">
             <Target className="text-indigo-400" size={20} />
             <span className="font-bold text-lg">Level {runState.level}</span>
          </div>
        </div>
        <div className="flex gap-4 sm:gap-6 text-sm sm:text-base text-gray-400 bg-gray-950 px-4 py-2 rounded-lg border border-gray-800">
          <span className="flex items-center gap-1"><MousePointerClick size={16} className="text-orange-400"/> {formatNumber(runState._currentClick)}</span>
          <span className="flex items-center gap-1"><Activity size={16} className="text-emerald-400"/> {formatNumber(runState._currentPassive)}/s</span>
          <span className="flex items-center gap-1"><TrendingUp size={16} className="text-blue-400"/> {runState._currentMult.toFixed(2)}x</span>
        </div>
      </div>

      {/* MAIN GAME AREA */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        
        {/* Timer */}
        <div className={`text-6xl sm:text-7xl font-black mb-8 tracking-tighter tabular-nums transition-colors duration-200 ${
          isTimerLow ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]' : 'text-gray-300'
        }`}>
          {formatTime(runState.timeRemaining)}
        </div>

        {/* Power Displays */}
        <div className="text-center w-full max-w-3xl mb-12">
          <h1 className="text-7xl sm:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-indigo-300 to-purple-600 drop-shadow-2xl mb-4 truncate">
            {formatNumber(runState.power)}
          </h1>
          
          <div className="flex items-center justify-between text-gray-500 mb-2 font-bold px-2 text-sm sm:text-base">
            <span>0</span>
            <span>Target: {formatNumber(runState.checkpoint)}</span>
          </div>
          
          {/* Progress Bar */}
          <div className="h-6 w-full bg-gray-900 rounded-full overflow-hidden border border-gray-700 shadow-inner relative">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-100 ease-linear shadow-[0_0_20px_rgba(168,85,247,0.5)]"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Clicker Button */}
        <button 
          onPointerDown={handleManualClick}
          className="relative group w-56 h-56 sm:w-72 sm:h-72 rounded-full bg-gradient-to-b from-gray-800 to-gray-900 border-2 border-gray-700 shadow-[0_0_40px_rgba(99,102,241,0.2)] hover:shadow-[0_0_100px_rgba(168,85,247,0.5)] hover:border-purple-500 active:scale-95 active:shadow-[0_0_20px_rgba(168,85,247,0.8)] transition-all flex items-center justify-center touch-none overflow-hidden outline-none"
        >
          <div className="absolute inset-0 bg-indigo-500/5 group-hover:bg-purple-500/20 transition-colors" />
          <Power size={100} className="text-gray-500 group-hover:text-purple-300 group-active:text-white transition-colors z-10" />
        </button>
      </div>

      {/* INVENTORY FOOTER */}
      <div className="h-28 sm:h-32 border-t border-gray-800 bg-gray-900 p-4 flex gap-3 overflow-x-auto items-center justify-center shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        {Object.keys(runState.items).length === 0 && (
          <span className="text-gray-600 italic text-sm sm:text-base">No anomalies drafted yet...</span>
        )}
        {Object.entries(runState.items).map(([id, count]) => {
          const def = ITEM_DEFS[id];
          const Icon = def.icon;
          return (
            <div key={id} className="relative group cursor-pointer flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-gray-800 border border-gray-700 rounded-xl hover:border-gray-400 transition-colors shrink-0">
              <Icon className={def.color} size={28} />
              <span className="absolute -bottom-2 -right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full border-2 border-gray-900 shadow-md">
                {count}
              </span>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-3 w-56 p-3 bg-gray-950 border border-gray-700 text-sm rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20 text-center">
                <strong className="block text-white mb-1 text-base">{def.name}</strong>
                <span className="text-gray-400 text-xs leading-tight">{def.desc}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- MODALS --- */}

      {/* Start Screen */}
      {gameState === 'start' && (
        <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center z-50 p-6 text-center backdrop-blur-sm">
          <Power size={80} className="text-indigo-500 mb-8 animate-pulse" />
          <h1 className="text-5xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-600 mb-6 drop-shadow-lg">
            SYS_OVERRIDE
          </h1>
          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mb-12 leading-relaxed">
            Generate power. Beat the countdown. Draft anomalies. <br className="hidden sm:block"/>
            Inevitable failure yields permanent strength.
          </p>
          <button 
            onClick={startRun} 
            className="px-12 py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-2xl rounded-2xl shadow-[0_0_40px_rgba(99,102,241,0.6)] hover:shadow-[0_0_80px_rgba(99,102,241,0.8)] hover:-translate-y-1 transition-all"
          >
            INITIALIZE RUN
          </button>
        </div>
      )}

      {/* Draft Overlay */}
      {gameState === 'drafting' && (
        <div className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center p-4 z-50 backdrop-blur-md overflow-y-auto py-12">
          <div className="max-w-5xl w-full text-center">
            <h2 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500 mb-2">
              CHECKPOINT CLEARED
            </h2>
            <p className="text-gray-400 text-lg sm:text-xl mb-10">Select an anomaly to integrate into your systems.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
              {draftOptions.map(id => {
                const def = ITEM_DEFS[id];
                const Icon = def.icon;
                return (
                  <button 
                    key={id}
                    onClick={() => selectDraftItem(id)}
                    className="relative overflow-hidden group flex flex-col items-center p-8 bg-gray-900/80 rounded-2xl border-2 border-gray-700 hover:border-indigo-400 hover:shadow-[0_0_30px_rgba(99,102,241,0.3)] hover:-translate-y-2 transition-all duration-300 text-center"
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/50 group-hover:to-indigo-900/30 transition-colors" />
                    <Icon className={`w-20 h-20 mb-6 ${def.color} group-hover:scale-125 transition-transform duration-500 z-10 drop-shadow-md`} />
                    <h3 className="text-2xl font-black text-white mb-4 z-10">{def.name}</h3>
                    <p className="text-gray-300 text-sm sm:text-base leading-relaxed z-10">{def.desc}</p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Game Over / Prestige Shop Overlay */}
      {gameState === 'gameover' && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50 backdrop-blur-md overflow-y-auto">
          <div className="bg-gray-900 border-2 border-red-900/50 p-6 sm:p-10 rounded-3xl max-w-2xl w-full shadow-2xl my-8">
            
            <div className="text-center mb-10">
              <h2 className="text-4xl sm:text-5xl font-black text-red-500 mb-4 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">
                SYSTEM FAILURE
              </h2>
              <p className="text-gray-400 text-lg">Power reserves depleted before reaching Level {runState.level}.</p>
              
              <div className="mt-6 inline-flex items-center gap-3 bg-yellow-500/10 px-8 py-4 rounded-2xl border border-yellow-500/20 shadow-inner">
                <Trophy className="text-yellow-500" size={28} />
                <span className="text-2xl font-black text-yellow-500">+{pendingPrestige} Prestige Points</span>
              </div>
            </div>

            <div className="bg-gray-950 p-6 rounded-2xl border border-gray-800 mb-8">
               <h3 className="text-xl font-bold text-gray-300 mb-4 flex items-center gap-2">
                 <Zap size={20} className="text-indigo-400" /> Permanent Upgrades
               </h3>
               <div className="space-y-4">
                 <UpgradeRow type="click" title="Enhanced Actuators" desc="+1 Base Click Power." icon={MousePointerClick} />
                 <UpgradeRow type="passive" title="Idle Engines" desc="+2 Base Passive Power/sec." icon={Activity} />
                 <UpgradeRow type="time" title="Temporal Dilator" desc="+2 Seconds to Max Timer." icon={Clock} />
               </div>
            </div>

            <button 
              onClick={startRun} 
              className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-2xl text-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:shadow-[0_0_40px_rgba(99,102,241,0.6)]"
            >
              REBOOT SYSTEM
            </button>

          </div>
        </div>
      )}

    </div>
  );
}