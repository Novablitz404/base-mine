"use client";

import {
  useMiniKit,
  useAddFrame,
  useComposeCast,
} from "@coinbase/onchainkit/minikit";
import {
  Name,
} from "@coinbase/onchainkit/identity";
import {
  ConnectWallet,
  Wallet,
} from "@coinbase/onchainkit/wallet";
import Image from "next/image";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useDisconnect, useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { BASEMINER_ABI, CONTRACT_ADDRESS } from "../lib/contract";
import { formatEther, parseEther } from "viem";
import { base } from "wagmi/chains";

export default function App() {
  const { setFrameReady, isFrameReady, context } = useMiniKit();
  const addFrame = useAddFrame();
  const { composeCast } = useComposeCast();
  const { disconnect, connectors } = useDisconnect();
  const { isConnected, address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  
  // Contract interaction hooks
  const { data: walletBalanceData, refetch: refetchWalletBalance } = useBalance({
    address: address,
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });
  
  const { data: contractBalanceData, refetch: refetchContractBalance } = useBalance({
    address: CONTRACT_ADDRESS,
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });
  
  const { data: userMiners, refetch: refetchUserMiners } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getMyMiners',
    args: address ? [address] : undefined,
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });
  
  const { data: userEggs, refetch: refetchUserEggs } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getMyEggs',
    args: address ? [address] : undefined,
    query: {
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });

  // Get the ETH value of user's eggs (what they can sell)
  const { data: eggValue, refetch: refetchEggValue } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'calculateEggSell',
    args: userEggs ? [userEggs] : undefined,
    query: {
      enabled: !!userEggs && !!address,
      refetchInterval: 5000, // Refetch every 5 seconds
    },
  });
  // Get last hatch time for countdown
  const { data: lastHatchData, refetch: refetchLastHatch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'lastHatch',
    args: address ? [address] : undefined,
    query: {
      refetchInterval: 5000,
    },
  });

  // Contract write hooks
  const { writeContract, data: hash } = useWriteContract();
  const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  // Separate loading states for each button
  const [isMining, setIsMining] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  
  // Info modal state
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  // Refetch data after successful transactions
  useEffect(() => {
    if (isConfirmed) {
      // Refetch all user data with a small delay to ensure contract state is updated
      setTimeout(() => {
        refetchWalletBalance();
        refetchContractBalance();
        refetchUserMiners();
        refetchUserEggs();
        refetchEggValue();
        refetchLastHatch();
        
        // Second refetch for egg value to ensure it gets updated data
        setTimeout(() => {
          refetchEggValue();
        }, 500);
      }, 1000); // 1 second delay
    }
  }, [isConfirmed, refetchWalletBalance, refetchContractBalance, refetchUserMiners, refetchUserEggs, refetchEggValue, refetchLastHatch]);

  const [frameAdded, setFrameAdded] = useState(false);
  const [inputAmount, setInputAmount] = useState("0");
  const [referralAddress, setReferralAddress] = useState<string>("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastKnownRewards, setLastKnownRewards] = useState("0");
  const [timeUntilHatch, setTimeUntilHatch] = useState<number>(0);
  const [hasNotifiedRefineReady, setHasNotifiedRefineReady] = useState(false);
  
  // Real-time data from contract
  const walletBalance = walletBalanceData ? formatEther(walletBalanceData.value) : "0";
  const contractBalance = contractBalanceData ? formatEther(contractBalanceData.value) : "0";
  const userGems = userMiners ? userMiners.toString() : "0";
  
  // Loading states for individual values
  const isLoadingWalletBalance = !walletBalanceData && isConnected;
  const isLoadingContractBalance = !contractBalanceData;
  const isLoadingUserData = !userMiners && !userEggs && isConnected;
  const isLoadingRewards = !eggValue && !lastKnownRewards && isConnected;
  
  // Calculate user rewards with fallback and preserve last known value
  const currentRewards = eggValue ? formatEther(eggValue) : "0";
  const userRewards = currentRewards !== "0" ? currentRewards : lastKnownRewards;
  
  // Update last known rewards when we have a valid value
  useEffect(() => {
    if (currentRewards !== "0") {
      setLastKnownRewards(currentRewards);
    }
  }, [currentRewards]);

  // Countdown timer logic
  useEffect(() => {
    const updateCountdown = () => {
      if (!lastHatchData || !address) return;
      
      const lastHatchTime = Number(lastHatchData) * 1000; // Convert to milliseconds
      const hatchCooldown = 3600000; // 1 hour in milliseconds
      const nextHatchTime = lastHatchTime + hatchCooldown;
      const now = Date.now();
      const remaining = Math.max(0, nextHatchTime - now);
      
      setTimeUntilHatch(remaining);
      
      // Send notification when cooldown is over
      if (remaining <= 0 && !hasNotifiedRefineReady && context?.client?.added) {
        setHasNotifiedRefineReady(true);
        sendNotification(
          "🔧 Refine Cooldown Complete!",
          "Your gems are ready to refine! Come back to BaseMiner to convert your gems into miners."
        );
      }
      
      // Reset notification flag when cooldown starts again
      if (remaining > 0) {
        setHasNotifiedRefineReady(false);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000); // Update every second

    return () => clearInterval(interval);
  }, [lastHatchData, address, hasNotifiedRefineReady, context?.client?.added]);

  // Format countdown time
  const formatCountdown = (ms: number) => {
    if (ms <= 0) return "Ready";
    
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const isHatchReady = timeUntilHatch <= 0;

  useEffect(() => {
    if (!isFrameReady) {
      setFrameReady();
    }
  }, [setFrameReady, isFrameReady]);

  // Fix hydration mismatch
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Extract referral from URL on component mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');
    if (refParam && refParam.startsWith('0x') && refParam.length === 42) {
      setReferralAddress(refParam);
    }
  }, []);

  // Auto-switch to Base Mainnet when connected
  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id) {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  const handleAddFrame = useCallback(async () => {
    const frameAdded = await addFrame();
    setFrameAdded(Boolean(frameAdded));
  }, [addFrame]);

  const handleDisconnect = useCallback(() => {
    // Disconnect all the connectors (wallets). Usually only one is connected
    connectors.map((connector) => disconnect({ connector }));
  }, [disconnect, connectors]);

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handlePercentageClick = (percentage: number) => {
    const amount = (parseFloat(walletBalance) * percentage / 100).toFixed(6);
    setInputAmount(amount);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputAmount(e.target.value);
  };


  // Function to truncate to 4 decimal places without rounding
  const truncateTo4Decimals = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0.0000";
    const truncated = Math.floor(num * 10000) / 10000;
    return truncated.toFixed(4);
  };


  // Contract interaction functions
  const handleMineGems = async () => {
    if (!address || !inputAmount || parseFloat(inputAmount) <= 0) return;
    
    setIsMining(true);
    try {
      await writeContract({
        address: CONTRACT_ADDRESS,
        abi: BASEMINER_ABI,
        functionName: 'buyEggs',
        args: [(referralAddress || address) as `0x${string}`], // Use referral from URL, fallback to self
        value: parseEther(inputAmount),
      });
    } catch (err) {
      console.error('Error mining gems:', err);
    } finally {
      setIsMining(false);
    }
  };

  const handleRefineGems = async () => {
    if (!address) return;
    
    setIsRefining(true);
    try {
      await writeContract({
        address: CONTRACT_ADDRESS,
        abi: BASEMINER_ABI,
        functionName: 'hatchEggs',
        args: [],
      });
    } catch (err) {
      console.error('Error refining gems:', err);
    } finally {
      setIsRefining(false);
    }
  };

  const handleSellGems = async () => {
    if (!address) return;
    
    setIsSelling(true);
    try {
      await writeContract({
        address: CONTRACT_ADDRESS,
        abi: BASEMINER_ABI,
        functionName: 'sellEggs',
        args: [],
      });
    } catch (err) {
      console.error('Error selling gems:', err);
    } finally {
      setIsSelling(false);
    }
  };

  // Share referral link function
  const handleShareReferral = () => {
    if (!address) return;
    
    const referralLink = `https://baseminer.app/ref/${address}`;
    const shareText = `🎮 Just discovered BaseMiner - the ultimate mining game on Base! 
    
⛏️ Mine gems, refine them, and earn ETH rewards
💰 Dynamic fees and referral rewards
🛡️ Protected against whale attacks

Join me and start mining: ${referralLink}`;
    
    composeCast({
      text: shareText,
      embeds: [referralLink]
    });
  };

  // Send notification function
  const sendNotification = async (title: string, body: string) => {
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fid: 0, // FID will be determined by the webhook system
          notification: {
            title,
            body,
          },
        }),
      });

      if (!response.ok) {
        console.error('Failed to send notification:', await response.text());
      }
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };

  const saveFrameButton = useMemo(() => {
    if (context && !context.client.added) {
      return (
        <button
          onClick={handleAddFrame}
          className="text-[var(--app-accent)] p-4 hover:bg-[var(--app-accent-light)] rounded-lg transition-colors"
        >
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-sm font-medium">Save Frame</span>
          </div>
        </button>
      );
    }

    if (frameAdded) {
      return (
        <div className="flex items-center space-x-1 text-sm font-medium text-[#0052FF] animate-fade-out">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Saved</span>
        </div>
      );
    }

    return null;
  }, [context, frameAdded, handleAddFrame]);

  if (!isHydrated) {
    return (
      <div className="flex flex-col min-h-screen font-sans text-[var(--app-foreground)] mini-app-theme" style={{ fontFamily: 'Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', backgroundImage: 'url(/Base-miner-Background.svg)', backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat' }}>
        <div className="w-full max-w-md mx-auto px-4 py-3">
          <header className="flex justify-between items-center mb-3 h-11">
            <div></div>
            <div>
              <div className="bg-[#0927eb] text-white px-4 py-2 rounded-lg font-semibold text-sm min-w-[120px] inline-flex items-center justify-center">
                Loading...
              </div>
            </div>
          </header>
          <main className="flex-1">
            <div className="space-y-6 animate-fade-in">
              {/* BaseMiner Game Interface */}
              <div className="bg-[#2d2d2d] backdrop-blur-md rounded-xl shadow-lg border border-[var(--app-card-border)] overflow-hidden">
                <div className="p-5 space-y-6 pixel-font">
                  {/* Information Display */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-white font-semibold text-sm tracking-wide">CONTRACT</span>
                      <span className="text-white font-semibold text-sm">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white font-semibold text-sm tracking-wide">WALLET</span>
                      <span className="text-white font-semibold text-sm">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white font-semibold text-sm tracking-wide">YOUR GEMS</span>
                      <span className="text-white font-semibold text-sm">Loading...</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen font-sans text-[var(--app-foreground)] mini-app-theme" style={{ fontFamily: 'Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', backgroundImage: 'url(/Base-miner-Background.svg)', backgroundSize: 'cover', backgroundPosition: 'center center', backgroundRepeat: 'no-repeat' }}>
      <div className="w-full max-w-md mx-auto px-4 py-3">
        <header className="flex justify-between items-center mb-3 h-11">
          <div>{saveFrameButton}</div>
          <div>
            <div className="flex items-center space-x-4">
              {/* Info Link */}
              <span
                onClick={() => setIsInfoModalOpen(true)}
                className="hover:opacity-80 transition-opacity duration-200 cursor-pointer"
                title="Game Mechanics"
              >
                <Image src="/info-icon.svg" alt="Info" width={24} height={24} className="w-6 h-6" />
              </span>
              
              {isConnected ? (
                <button
                  onClick={handleDisconnect}
                  className="bg-[#0927eb] hover:bg-[#0820d1] text-white px-4 py-2 rounded-lg font-semibold text-sm transition-colors duration-200 min-w-[120px] inline-flex items-center justify-center"
                >
                  {formatAddress(address)}
                </button>
              ) : (
                <Wallet className="z-10">
                  <ConnectWallet>
                    <Name className="text-white pixel-font" />
                  </ConnectWallet>
                </Wallet>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className="space-y-6 animate-fade-in">
            {/* BaseMiner Game Interface */}
            <div className="bg-[#2d2d2d] backdrop-blur-md rounded-xl shadow-lg border border-[var(--app-card-border)] overflow-hidden">
              <div className="p-5 space-y-6 pixel-font">
                {/* Information Display */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold text-sm tracking-wide">CONTRACT</span>
                    <span className="text-white font-semibold text-sm">
                      {isLoadingContractBalance ? 'Loading...' : `${parseFloat(contractBalance).toFixed(3)} ETH`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold text-sm tracking-wide">WALLET</span>
                    <span className="text-white font-semibold text-sm">
                      {isLoadingWalletBalance ? 'Loading...' : `${parseFloat(walletBalance).toFixed(3)} ETH`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white font-semibold text-sm tracking-wide">YOUR GEMS</span>
                    <span className="text-white font-semibold text-sm">
                      {isLoadingUserData ? 'Loading...' : `${userGems} GEMS`}
                    </span>
                  </div>
                </div>

                {/* Input Section */}
                <div className="space-y-4">
                  <div className="relative">
                    <input
                      type="text"
                      value={inputAmount}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 pr-16 text-center text-lg font-semibold border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.0"
                    />
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 font-semibold text-sm">
                      ETH
                    </div>
                  </div>

                  {/* Percentage Buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    {[25, 50, 75, 100].map((percentage) => (
                      <button
                        key={percentage}
                        onClick={() => handlePercentageClick(percentage)}
                        className="bg-[#0927eb] hover:bg-[#0820d1] text-white font-semibold py-2 px-3 rounded-lg transition-colors"
                      >
                        {percentage}%
                      </button>
                    ))}
                  </div>

                  {/* Main Action Button */}
                  <button 
                    onClick={handleMineGems}
                    disabled={!isConnected || !inputAmount || parseFloat(inputAmount) <= 0 || isMining}
                    className="w-full bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors text-sm"
                  >
                    {isMining ? 'MINING...' : 'MINE GEMS'}
                  </button>
                </div>

                {/* Rewards Section */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium">YOUR REWARDS</span>
                    <span className="text-white font-medium">
                      {isLoadingRewards ? 'Loading...' : `${truncateTo4Decimals(userRewards)} ETH`}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={handleRefineGems}
                      disabled={!isConnected || isRefining || !isHatchReady}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors pixel-font" 
                      style={{ fontSize: '10px' }}
                    >
                      <div className="w-full h-full flex items-center justify-center" style={{ 
                        fontFamily: '"Press Start 2P", monospace',
                        letterSpacing: '0.5px',
                        textShadow: 'none'
                      }}>
                        {isRefining ? 'REFINING...' : 
                         isHatchReady ? 'REFINE GEMS' : formatCountdown(timeUntilHatch)}
                      </div>
                    </button>
                    <button 
                      onClick={handleSellGems}
                      disabled={!isConnected || isSelling}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors" 
                      style={{ fontSize: '10px' }}
                    >
                      {isSelling ? 'SELLING...' : 'SELL GEMS'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Referral Link Section */}
            <div className="bg-[#2d2d2d] backdrop-blur-md rounded-xl shadow-lg border border-[var(--app-card-border)] overflow-hidden">
              <div className="p-5 space-y-4 pixel-font">
                <div className="text-center">
                  <h3 className="text-white font-semibold text-sm tracking-wide mb-3">YOUR REFERRAL LINK</h3>
                  <div className="bg-gray-800 rounded-lg p-3 mb-3">
                    <p className="text-gray-300 text-xs break-all">
                      {address ? `https://baseminer.app/ref/${address}` : 'Connect wallet to get your referral link'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => {
                        if (address) {
                          navigator.clipboard.writeText(`https://baseminer.app/ref/${address}`);
                          // You can add a toast notification here
                        }
                      }}
                      disabled={!address}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors text-xs"
                    >
                      COPY LINK
                    </button>
                    <button 
                      onClick={handleShareReferral}
                      disabled={!address}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors text-xs"
                    >
                      SHARE
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </main>

        <footer className="mt-2 pt-4 flex justify-center">
        </footer>
      </div>
      
      {/* Info Modal */}
      {isInfoModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#2d2d2d] rounded-xl shadow-lg border border-[var(--app-card-border)] max-w-md w-full max-h-[80vh] overflow-y-auto scrollbar-hide">
            <div className="p-6">
              {/* Header */}
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-white text-xl font-bold pixel-font">Game Mechanics</h2>
                <button
                  onClick={() => setIsInfoModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Content */}
              <div className="space-y-4 text-white text-sm">
                <div>
                  <h3 className="font-semibold text-white mb-2">🎮&nbsp;&nbsp;How to Play</h3>
                  <p className="text-gray-300">
                    BaseMiner is a decentralized mining game where you buy gems, refine them, and sell for profit.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">⛏️&nbsp;&nbsp;Mine Gems</h3>
                  <p className="text-gray-300">
                    Deposit ETH to buy gems. The more you invest, the more gems you get. Market grows by 20% on each buy.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">🔧&nbsp;&nbsp;Refine Gems</h3>
                  <p className="text-gray-300">
                    Convert gems into miners that generate more gems over time. 1-hour cooldown between refinements. Market grows by 8% on each refinement.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">💰&nbsp;&nbsp;Sell Gems</h3>
                  <p className="text-gray-300">
                    Convert your gems back to ETH. Dynamic fees apply based on market conditions. Daily withdrawal limits protect the ecosystem.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">👥&nbsp;&nbsp;Referral System</h3>
                  <p className="text-gray-300">
                    Share your referral link to earn 5% of gems when others buy using your link. Use ?ref=YOUR_ADDRESS in the URL.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">⚡&nbsp;&nbsp;Dynamic Fees</h3>
                  <p className="text-gray-300">
                    Buy fees start at 5% and decrease when TVL drops to encourage new users. Sell fees remain at 5% to maintain stability.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">🛡️&nbsp;&nbsp;Protection</h3>
                  <p className="text-gray-300">
                    Daily withdrawal limits and dynamic fees protect against whale attacks and ensure sustainable growth.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
