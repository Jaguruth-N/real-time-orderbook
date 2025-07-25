"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ChevronsUpDown, Info, BarChart2, Zap, TrendingUp, Activity, X } from 'lucide-react';

// --- Helper Functions & Constants ---

const VENUES = {
  okx: { name: 'OKX', ws: 'wss://ws.okx.com:8443/ws/v5/public' },
  bybit: { name: 'Bybit', ws: 'wss://stream.bybit.com/v5/public/spot' },
  deribit: { name: 'Deribit', ws: 'wss://www.deribit.com/ws/api/v2' },
};

const MAX_LEVELS = 15; // Number of orderbook levels to display
const TIMING_OPTIONS = { '0': 'Immediate', '5': '5s Delay', '10': '10s Delay', '30': '30s Delay' };
const TIMING_COLORS = { '0': 'ring-sky-400', '5': 'ring-amber-400', '10': 'ring-fuchsia-400', '30': 'ring-teal-400' };

// --- Main App Component ---

export default function App() {
  // --- State Management ---
  const [activeVenue, setActiveVenue] = useState('bybit');
  const [symbol, setSymbol] = useState('BTC-USDT');
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });
  const [marketStats, setMarketStats] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lastMessage, setLastMessage] = useState(null);

  // Simulation Form State
  const [orderForm, setOrderForm] = useState({
    side: 'Buy',
    type: 'Limit',
    price: '',
    quantity: '',
    delays: ['0'],
  });
  const [comparisonResults, setComparisonResults] = useState([]);
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Ref to hold the latest orderbook state for use in timeouts
  const orderbookRef = useRef(orderbook);
  useEffect(() => {
    orderbookRef.current = orderbook;
  }, [orderbook]);

  // --- WebSocket Connection Logic ---
  useEffect(() => {
    setOrderbook({ bids: [], asks: [] });
    setMarketStats({});
    setActiveSimulation(null);
    setComparisonResults([]);
    setConnectionStatus('Connecting...');

    const wsUrl = VENUES[activeVenue].ws;
    const ws = new WebSocket(wsUrl);
    let heartbeatInterval;

    const getNormalizedSymbol = (venue, sym) => {
      // Deribit uses PERPETUAL instruments
      if (venue === 'deribit') {
        return `${sym.split('-')[0]}-PERPETUAL`;
      }
      // Bybit spot needs no hyphen
      if (venue === 'bybit') {
        return sym.replace('-', '');
      }
      // For OKX spot, USDT is the common quote currency, not USD.
      if ((venue === 'okx' || venue === 'bybit') && sym.endsWith('-USD')) {
        return sym.replace('-USD', 'USDT');
      }
      // Default for OKX and others
      return sym;
    };

    ws.onopen = () => {
      setConnectionStatus('Connected');
      const normalizedSymbol = getNormalizedSymbol(activeVenue, symbol);
      let bookSubMsg, tickerSubMsg;

      try {
        switch (activeVenue) {
          case 'okx':
            bookSubMsg = { op: 'subscribe', args: [{ channel: 'books', instId: normalizedSymbol }] };
            tickerSubMsg = { op: 'subscribe', args: [{ channel: 'tickers', instId: normalizedSymbol }] };
            ws.send(JSON.stringify(bookSubMsg));
            ws.send(JSON.stringify(tickerSubMsg));
            heartbeatInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
            break;
          case 'bybit':
            bookSubMsg = { op: 'subscribe', args: [`orderbook.50.${normalizedSymbol}`] };
            tickerSubMsg = { op: 'subscribe', args: [`tickers.${normalizedSymbol}`] };
            ws.send(JSON.stringify(bookSubMsg));
            ws.send(JSON.stringify(tickerSubMsg));
            heartbeatInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); }, 18000);
            break;
          case 'deribit':
            bookSubMsg = { jsonrpc: '2.0', method: 'public/subscribe', params: { channels: [`book.${normalizedSymbol}.100ms`] } };
            tickerSubMsg = { jsonrpc: '2.0', method: 'public/subscribe', params: { channels: [`ticker.${normalizedSymbol}.100ms`] } };
            ws.send(JSON.stringify(bookSubMsg));
            ws.send(JSON.stringify(tickerSubMsg));
            heartbeatInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'public/test', params: {} })); }, 5000);
            break;
        }
      } catch (e) { console.error("Failed to send subscription message:", e); setConnectionStatus("Error"); }
    };

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      setLastMessage(new Date());
      const data = JSON.parse(event.data);
      if (data.event === 'error') { console.error("API Error:", data.msg); setConnectionStatus("Error"); return; }
      
      try {
        switch (activeVenue) {
          case 'okx':
            if (data.arg?.channel === 'books' && data.data) {
              const ob = data.data[0];
              const newBids = ob.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
              const newAsks = ob.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
              setOrderbook({ bids: newBids, asks: newAsks });
            } else if (data.arg?.channel === 'tickers' && data.data) {
              const stats = data.data[0];
              setMarketStats({ last: stats.last, vol24h: stats.volCcy24h });
            }
            break;
          case 'bybit':
            if (data.topic?.startsWith('orderbook')) {
              if (data.type === 'snapshot') {
                const ob = data.data;
                const newBids = ob.b.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
                const newAsks = ob.a.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
                setOrderbook({ bids: newBids, asks: newAsks });
              } else if (data.type === 'delta') {
                setOrderbook(currentBook => {
                  if (currentBook.bids.length === 0 && currentBook.asks.length === 0) return currentBook;
                  const updateSide = (currentSide, deltaSide) => {
                      const sideMap = new Map(currentSide);
                      if (deltaSide) {
                        for (const [priceStr, quantityStr] of deltaSide) {
                            const price = parseFloat(priceStr);
                            if (parseFloat(quantityStr) === 0) sideMap.delete(price);
                            else sideMap.set(price, parseFloat(quantityStr));
                        }
                      }
                      return [...sideMap.entries()];
                  };
                  let updatedBids = updateSide(currentBook.bids, data.data.b);
                  let updatedAsks = updateSide(currentBook.asks, data.data.a);
                  updatedBids.sort((a, b) => b[0] - a[0]);
                  updatedAsks.sort((a, b) => a[0] - b[0]);
                  return { bids: updatedBids, asks: updatedAsks };
                });
              }
            } else if (data.topic?.startsWith('tickers')) {
              const stats = data.data;
              setMarketStats({ last: stats.lastPrice, vol24h: stats.volume24h });
            }
            break;
          case 'deribit':
            if (data.params?.channel.startsWith('book')) {
              const ob = data.params.data;
              if (ob.type === 'snapshot') {
                const newBids = ob.bids.map(d => [d.price, d.amount / d.price]);
                const newAsks = ob.asks.map(d => [d.price, d.amount / d.price]);
                setOrderbook({ bids: newBids, asks: newAsks });
              } else if (ob.type === 'change') {
                setOrderbook(currentBook => {
                  if (currentBook.bids.length === 0 && currentBook.asks.length === 0) return currentBook;
                  const updateSide = (currentSide, deltaSide) => {
                    const sideMap = new Map(currentSide);
                    if (deltaSide) {
                      for (const [type, price, amount] of deltaSide) {
                        if (type === 'new' || type === 'change') sideMap.set(price, amount / price);
                        else if (type === 'delete') sideMap.delete(price);
                      }
                    }
                    return [...sideMap.entries()];
                  };
                  let updatedBids = updateSide(currentBook.bids, ob.bids);
                  let updatedAsks = updateSide(currentBook.asks, ob.asks);
                  updatedBids.sort((a, b) => b[0] - a[0]);
                  updatedAsks.sort((a, b) => a[0] - b[0]);
                  return { bids: updatedBids, asks: updatedAsks };
                });
              }
            } else if (data.params?.channel.startsWith('ticker')) {
              const stats = data.params.data;
              setMarketStats({ last: stats.last_price, vol24h: stats.volume_usd });
            }
            break;
        }
      } catch (error) { console.error("Error processing message:", error, data); }
    };
    ws.onerror = (error) => { console.error('WebSocket Error:', error); setConnectionStatus('Error'); };
    ws.onclose = () => { setConnectionStatus('Disconnected'); clearInterval(heartbeatInterval); };
    return () => { if (ws) ws.close(); clearInterval(heartbeatInterval); };
  }, [activeVenue, symbol]);

  const { bids, asks, maxTotal } = useMemo(() => {
    let processedBids = orderbook.bids.map(([p, q]) => ({ price: p || 0, quantity: q || 0, total: (p || 0) * (q || 0) }));
    let processedAsks = orderbook.asks.map(([p, q]) => ({ price: p || 0, quantity: q || 0, total: (p || 0) * (q || 0) }));
    if (activeSimulation) {
      const { side, price, quantity, type, delay } = activeSimulation;
      if (type === 'Limit') {
        const newOrder = { price, quantity, total: price * quantity, isSimulated: true, delay };
        if (side === 'Buy') {
          let inserted = false; const tempBids = [];
          for (const bid of processedBids) { if (price >= bid.price && !inserted) { tempBids.push(newOrder); inserted = true; } tempBids.push(bid); }
          if (!inserted) tempBids.push(newOrder); processedBids = tempBids;
        } else {
          let inserted = false; const tempAsks = [];
          for (const ask of processedAsks) { if (price <= ask.price && !inserted) { tempAsks.push(newOrder); inserted = true; } tempAsks.push(ask); }
          if (!inserted) tempAsks.push(newOrder); processedAsks = tempAsks;
        }
      } else {
        let remainingQuantity = quantity;
        if (side === 'Buy') {
          processedAsks = processedAsks.map(ask => {
            if (remainingQuantity > 0) { const consumed = Math.min(remainingQuantity, ask.quantity); remainingQuantity -= consumed; return { ...ask, isAffected: true, delay }; }
            return ask;
          });
        } else {
          processedBids = processedBids.map(bid => {
            if (remainingQuantity > 0) { const consumed = Math.min(remainingQuantity, bid.quantity); remainingQuantity -= consumed; return { ...bid, isAffected: true, delay }; }
            return bid;
          });
        }
      }
    }
    const maxQty = Math.max(...processedBids.slice(0, MAX_LEVELS).map(b => b.quantity), ...processedAsks.slice(0, MAX_LEVELS).map(a => a.quantity), 0);
    return { bids: processedBids.slice(0, MAX_LEVELS), asks: processedAsks.slice(0, MAX_LEVELS), maxTotal: maxQty };
  }, [orderbook, activeSimulation]);

  const depthChartData = useMemo(() => {
    if (bids.length === 0 && asks.length === 0) return [];
    const bidData = bids.slice().reverse().map((() => { let c = 0; return b => { c += b.quantity; return { price: b.price, Bids: c }; }; })());
    const askData = asks.map((() => { let c = 0; return a => { c += a.quantity; return { price: a.price, Asks: c }; }; })());
    if (bidData.length > 0 && askData.length > 0) {
      const highestBidPoint = bidData[bidData.length - 1];
      const lowestAskPoint = askData[0];
      bidData.push({ ...highestBidPoint, price: lowestAskPoint.price });
    }
    return [...bidData, ...askData];
  }, [bids, asks]);
  
  const orderBookImbalance = useMemo(() => {
    if (bids.length === 0 && asks.length === 0) return 50;
    const totalBids = bids.reduce((acc, curr) => acc + curr.quantity, 0);
    const totalAsks = asks.reduce((acc, curr) => acc + curr.quantity, 0);
    if (totalBids + totalAsks === 0) return 50;
    return (totalBids / (totalBids + totalAsks)) * 100;
  }, [bids, asks]);

  const handleSimulate = useCallback(async () => {
    const { side, type, price, quantity, delays } = orderForm;
    const priceNum = parseFloat(price);
    const quantityNum = parseFloat(quantity);
    if (!quantityNum || quantityNum <= 0 || (type === 'Limit' && (!priceNum || priceNum <= 0))) { alert("Please enter a valid quantity, and a price for limit orders."); return; }
    if (delays.length === 0) { alert("Please select at least one timing scenario."); return; }
    
    setIsSimulating(true);
    setComparisonResults([]);
    setActiveSimulation(null);

    const simulationPromises = delays.map(delay => 
      new Promise(resolve => {
        setTimeout(() => {
          const bookSnapshot = { bids: [...orderbookRef.current.bids], asks: [...orderbookRef.current.asks] };
          const bestAsk = bookSnapshot.asks[0]?.[0];
          const bestBid = bookSnapshot.bids[0]?.[0];
          const simPrice = type === 'Market' ? (side === 'Buy' ? bestAsk : bestBid) : priceNum;
          if (!simPrice) { resolve({ delay, metrics: null, error: "Market price not available." }); return; }
          
          let filledQuantity = 0, totalCost = 0, remainingQuantity = quantityNum;
          if (side === 'Buy') {
            for (const [askPrice, askQuantity] of bookSnapshot.asks) {
              if (type === 'Market' || simPrice >= askPrice) {
                const fill = Math.min(remainingQuantity, askQuantity);
                filledQuantity += fill; totalCost += fill * askPrice; remainingQuantity -= fill;
                if (remainingQuantity <= 0) break;
              }
            }
          } else {
            for (const [bidPrice, bidQuantity] of bookSnapshot.bids) {
              if (type === 'Market' || simPrice <= bidPrice) {
                const fill = Math.min(remainingQuantity, bidQuantity);
                filledQuantity += fill; totalCost += fill * bidPrice; remainingQuantity -= fill;
                if (remainingQuantity <= 0) break;
              }
            }
          }
          const fillPercentage = quantityNum > 0 ? (filledQuantity / quantityNum) * 100 : 0;
          const avgFillPrice = filledQuantity > 0 ? totalCost / filledQuantity : null;
          const marketPrice = side === 'Buy' ? bestAsk : bestBid;
          const slippage = marketPrice && avgFillPrice ? Math.abs(((avgFillPrice - marketPrice) / marketPrice) * 100) : null;
          const result = { delay, metrics: { fillPercentage, avgFillPrice, slippage, marketPrice, warning: slippage !== null && slippage > 1 ? "Warning: High market impact expected!" : null }, orderDetails: { side, price: simPrice, quantity: quantityNum, type, delay } };
          resolve(result);
        }, parseInt(delay, 10) * 1000);
      })
    );
    
    const results = await Promise.all(simulationPromises);
    setComparisonResults(results);
    if (results.length > 0 && results[0].orderDetails) {
      setActiveSimulation(results[0].orderDetails);
    }
    setIsSimulating(false);
  }, [orderForm]);

  const handleFormChange = (e) => setOrderForm({ ...orderForm, [e.target.name]: e.target.value });
  const handleDelayChange = (delay) => {
    setOrderForm(prev => {
      const newDelays = prev.delays.includes(delay)
        ? prev.delays.filter(d => d !== delay)
        : [...prev.delays, delay];
      return { ...prev, delays: newDelays };
    });
  };
  
  return (
    <div className="bg-slate-900 text-slate-300 min-h-screen font-sans antialiased">
      <div className="container mx-auto p-4 lg:p-6">
        <style>{`.animate-pulse-bg { animation: pulse-bg 1.5s infinite; } @keyframes pulse-bg { 0%, 100% { background-color: rgba(56, 189, 248, 0.3); } 50% { background-color: rgba(56, 189, 248, 0.5); } }`}</style>
        <header className="mb-6 lg:mb-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">Real-Time Orderbook Viewer</h1>
          <div className="flex items-center space-x-6 mt-2 text-slate-400">
            <MarketStat icon={TrendingUp} label="Last Price" value={marketStats.last ? parseFloat(marketStats.last).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'} />
            <MarketStat icon={Activity} label="24h Volume" value={marketStats.vol24h ? `${parseFloat(marketStats.vol24h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'} />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg border border-slate-700/50">
              <h2 className="text-xl font-semibold mb-4 text-white">Controls</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-2">Venue</label>
                <div className="flex space-x-1 bg-slate-900 p-1 rounded-lg">
                  {Object.keys(VENUES).map(key => (<button key={key} onClick={() => setActiveVenue(key)} className={`flex-1 py-2 text-sm rounded-md transition-all duration-300 ${activeVenue === key ? 'bg-sky-500 text-white font-bold shadow-md' : 'hover:bg-slate-700'}`}>{VENUES[key].name}</button>))}
                </div>
              </div>
              <div className="mb-4">
                <label htmlFor="symbol" className="block text-sm font-medium text-slate-400 mb-2">Symbol</label>
                <input type="text" id="symbol" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="w-full bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-all duration-300" />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Status:</span>
                <span className={`font-bold flex items-center ${connectionStatus === 'Connected' ? 'text-green-400' : connectionStatus === 'Connecting...' ? 'text-yellow-400' : 'text-red-400'}`}>
                  <span className={`w-2 h-2 rounded-full mr-2 ${connectionStatus === 'Connected' ? 'bg-green-500' : connectionStatus === 'Connecting...' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`}></span>
                  {connectionStatus}
                </span>
              </div>
              {lastMessage && <p className="text-xs text-slate-500 mt-1">Last update: {lastMessage.toLocaleTimeString()}</p>}
            </div>
            
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg border border-slate-700/50">
              <h2 className="text-xl font-semibold mb-4 text-white flex items-center"><Zap size={20} className="text-sky-400 mr-2"/>Order Simulation</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><label className="block text-sm font-medium text-slate-400 mb-2">Side</label><select name="side" value={orderForm.side} onChange={handleFormChange} className="w-full bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2"><option>Buy</option><option>Sell</option></select></div>
                <div><label className="block text-sm font-medium text-slate-400 mb-2">Type</label><select name="type" value={orderForm.type} onChange={handleFormChange} className="w-full bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2"><option>Limit</option><option>Market</option></select></div>
              </div>
              <div className="mb-4"><label className="block text-sm font-medium text-slate-400 mb-2">Price</label><input type="number" name="price" value={orderForm.price} onChange={handleFormChange} disabled={orderForm.type === 'Market'} className="w-full bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2 disabled:bg-slate-800 disabled:text-slate-500" placeholder={orderForm.type === 'Market' ? 'Market Price' : 'Enter price'} /></div>
              <div className="mb-4"><label className="block text-sm font-medium text-slate-400 mb-2">Quantity</label><input type="number" name="quantity" value={orderForm.quantity} onChange={handleFormChange} className="w-full bg-slate-900/70 border border-slate-700 rounded-lg px-3 py-2" placeholder="Enter quantity" /></div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-2">Timing Scenarios</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(TIMING_OPTIONS).map(([value, label]) => (
                    <label key={value} className={`flex items-center space-x-2 p-2 rounded-lg cursor-pointer transition-all ${orderForm.delays.includes(value) ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-900/70'}`}>
                      <input type="checkbox" checked={orderForm.delays.includes(value)} onChange={() => handleDelayChange(value)} className="form-checkbox h-4 w-4 rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-sky-500" />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={handleSimulate} disabled={isSimulating} className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 px-4 rounded-lg transition-all duration-300 disabled:bg-sky-800 disabled:cursor-not-allowed shadow-lg shadow-sky-900/50">{isSimulating ? `Simulating...` : 'Run Simulation'}</button>
            </div>
          </div>
          <div className="lg:col-span-4">
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg h-full border border-slate-700/50">
                <div className="flex justify-between items-center border-b border-slate-700 pb-3 mb-3"><h2 className="text-xl font-semibold text-white">Order Book</h2><ChevronsUpDown className="text-slate-500" /></div>
                <div className="grid grid-cols-3 text-xs text-slate-400 mb-2 px-2 font-semibold"><span>Price ({symbol.split('-')[1]})</span><span className="text-right">Quantity ({symbol.split('-')[0]})</span><span className="text-right">Total</span></div>
                <div className="h-[calc(100%-50px)] overflow-y-auto pr-1">
                    <div className="asks">{asks.slice().reverse().map((ask, i) => (<OrderBookRow key={`ask-${ask.price}-${i}`} {...ask} type="ask" maxTotal={maxTotal}/>))}</div>
                    <div className="py-2 my-1 text-center border-y border-slate-700/50"><span className="text-lg font-mono text-white">{asks[0] && bids[0] ? (asks[0].price - bids[0].price).toPrecision(2) : '-'}</span></div>
                    <div className="bids">{bids.map((bid, i) => (<OrderBookRow key={`bid-${bid.price}-${i}`} {...bid} type="bid" maxTotal={maxTotal}/>))}</div>
                </div>
            </div>
          </div>
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg h-[400px] border border-slate-700/50">
                <div className="flex justify-between items-center border-b border-slate-700 pb-3 mb-4"><h2 className="text-xl font-semibold text-white">Market Depth</h2><BarChart2 className="text-slate-500" /></div>
                <ResponsiveContainer width="100%" height="85%"><AreaChart data={depthChartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}><defs><linearGradient id="colorBids" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient><linearGradient id="colorAsks" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/><stop offset="95%" stopColor="#EF4444" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="price" stroke="#9CA3AF" tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} type="number" /><YAxis stroke="#9CA3AF" tick={{ fontSize: 10 }} orientation="right" allowDataOverflow /><Tooltip content={<CustomTooltip />} /><Legend /><Area type="step" dataKey="Bids" stroke="#10B981" fillOpacity={1} fill="url(#colorBids)" connectNulls /><Area type="step" dataKey="Asks" stroke="#EF4444" fillOpacity={1} fill="url(#colorAsks)" connectNulls /></AreaChart></ResponsiveContainer>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg border border-slate-700/50">
                <div className="flex justify-between items-center mb-3 border-b border-slate-700 pb-2"><h3 className="text-lg font-semibold flex items-center text-white"><Info size={18} className="text-sky-400 mr-2"/>Simulation Impact</h3>{comparisonResults.length > 0 && <button onClick={() => {setComparisonResults([]); setActiveSimulation(null);}} className="text-xs text-slate-400 hover:text-white flex items-center"><X size={14} className="mr-1"/>Clear</button>}</div>
                {isSimulating && <p className="text-sm text-slate-500">Running simulations...</p>}
                {comparisonResults.length > 0 ? (<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{comparisonResults.map((result) => (<div key={result.delay} onClick={() => setActiveSimulation(result.orderDetails)} className={`bg-slate-900/50 p-3 rounded-lg cursor-pointer transition-all border ${activeSimulation?.delay === result.delay ? 'border-sky-400' : 'border-transparent hover:border-slate-600'}`}><h4 className="font-bold text-sky-300 mb-2">{TIMING_OPTIONS[result.delay]}</h4>{result.error ? <p className="text-sm text-red-400">{result.error}</p> : <div className="space-y-2 text-sm"><MetricRow label="Est. Fill %" value={typeof result.metrics.fillPercentage === 'number' ? `${result.metrics.fillPercentage.toFixed(2)}%` : 'N/A'} /><MetricRow label="Avg. Fill Price" value={typeof result.metrics.avgFillPrice === 'number' ? result.metrics.avgFillPrice.toFixed(2) : 'N/A'} /><MetricRow label="Market Price" value={typeof result.metrics.marketPrice === 'number' ? result.metrics.marketPrice.toFixed(2) : 'N/A'} /><MetricRow label="Slippage" value={typeof result.metrics.slippage === 'number' ? `${result.metrics.slippage.toFixed(4)}%` : 'N/A'} />{result.metrics.warning && <p className="text-yellow-400 text-xs pt-2 font-semibold">{result.metrics.warning}</p>}</div>}</div>))}</div>) : (!isSimulating && <p className="text-sm text-slate-500">Run a simulation to see impact metrics.</p>)}
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4 shadow-lg border border-slate-700/50">
                <h3 className="text-lg font-semibold mb-3 border-b border-slate-700 pb-2 text-white">Book Imbalance</h3>
                <div className="w-full bg-slate-700 rounded-full h-2.5 mt-4 flex overflow-hidden"><div className="bg-green-500 h-2.5" style={{ width: `${orderBookImbalance}%` }}></div><div className="bg-red-500 h-2.5" style={{ width: `${100 - orderBookImbalance}%` }}></div></div>
                <div className="flex justify-between text-xs mt-2 font-mono"><span className="text-green-400 font-bold">Bids {orderBookImbalance.toFixed(1)}%</span><span className="text-red-400 font-bold">{(100 - orderBookImbalance).toFixed(1)}% Asks</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Child Components ---
const MarketStat = ({ icon: Icon, label, value }) => (<div className="flex items-center space-x-2"><Icon className="text-slate-500" size={18} /><div className="flex items-baseline"><span className="text-lg font-bold text-white font-mono">{value}</span><span className="text-xs text-slate-400 ml-1.5">{label}</span></div></div>);
const OrderBookRow = ({ price, quantity, total, type, isSimulated, isAffected, maxTotal, delay }) => {
    const colorClass = type === 'bid' ? 'text-green-400' : 'text-red-400';
    const barColorClass = type === 'bid' ? 'bg-green-500/10' : 'bg-red-500/10';
    const barWidth = maxTotal > 0 ? (quantity / maxTotal) * 100 : 0;
    let rowClasses = 'relative flex justify-between items-center text-sm p-1.5 rounded-md my-0.5';
    if (isSimulated) rowClasses += ` ring-2 ${TIMING_COLORS[delay] || 'ring-sky-400'} ring-inset`;
    if (isAffected) rowClasses += ' animate-pulse-bg';
    return (<div className={rowClasses}><div className={`absolute top-0 h-full ${barColorClass}`} style={{ width: `${barWidth}%`, right: type === 'bid' ? 'auto' : 0, left: type === 'bid' ? 0 : 'auto' }}></div><span className={`relative font-mono font-semibold ${colorClass}`}>{price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span><span className="relative font-mono text-white">{(quantity || 0).toFixed(4)}</span><span className="relative font-mono text-slate-400">{(total || 0).toFixed(2)}</span></div>);
};
const MetricRow = ({ label, value }) => (<div className="flex justify-between"><span className="text-slate-400">{label}:</span><span className="font-mono font-bold text-white">{value}</span></div>);
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const bidPayload = payload.find(p => p.dataKey === 'Bids');
    const askPayload = payload.find(p => p.dataKey === 'Asks');
    return (<div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 text-sm backdrop-blur-sm"><p className="label font-bold text-white">{`Price: ${label}`}</p>{bidPayload && bidPayload.value > 0 && <p style={{ color: bidPayload.color }}>{`Bid Depth: ${bidPayload.value.toFixed(2)}`}</p>}{askPayload && askPayload.value > 0 && <p style={{ color: askPayload.color }}>{`Ask Depth: ${askPayload.value.toFixed(2)}`}</p>}</div>);
  }
  return null;
};
