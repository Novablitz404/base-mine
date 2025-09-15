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
// Note: We'll use window.ethereum.request directly for capabilities
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
  const { isConnected, address, chainId, connector } = useAccount();
  const { switchChain } = useSwitchChain();
  
  // Base Account capabilities for sponsored gas
  const [hasPaymasterSupport, setHasPaymasterSupport] = useState(false);
  
  // Tooltip state for rewards precision
  const [showRewardsTooltip, setShowRewardsTooltip] = useState(false);
  
  // TVL breakdown dropdown state
  const [showTVLBreakdown, setShowTVLBreakdown] = useState(false);
  
  // Copy notification state
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  
  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showRewardsTooltip) {
        setShowRewardsTooltip(false);
      }
    };
    
    if (showRewardsTooltip) {
      document.addEventListener('click', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showRewardsTooltip]);
  
  // Manual capability check function
  const checkCapabilitiesManually = async () => {
    if (!address) {
      alert('Please connect your wallet first');
      return;
    }
    
    // Try to get the wallet provider from wagmi connector
    let walletProvider = null;
    
    // First try to get from wagmi connector
    if (connector?.getProvider) {
      try {
        walletProvider = await connector.getProvider();
        console.log('🔗 Using wagmi connector provider:', walletProvider);
      } catch (error) {
        console.log('Failed to get provider from connector:', error);
      }
    }
    // Fallback to window.ethereum
    if (!walletProvider && window.ethereum) {
      walletProvider = window.ethereum;
      console.log('🔗 Using window.ethereum provider:', walletProvider);
    }
    
    if (!walletProvider) {
      alert('No wallet provider detected. Please ensure your wallet is properly connected.');
      return;
    }
    
    try {
      console.log('🔍 Manually checking capabilities for:', address);
      console.log('🔗 Wallet provider:', walletProvider);
      
      const capabilities = await walletProvider.request({
        method: 'wallet_getCapabilities',
        params: [address]
      });
      
      console.log('📋 Capabilities response:', capabilities);
      
      const baseCapabilities = capabilities?.['0x2105'];
      const paymasterService = baseCapabilities?.paymasterService;
      const supported = paymasterService?.supported;
      
      console.log('🔗 Base capabilities:', baseCapabilities);
      console.log('⛽ Paymaster service:', paymasterService);
      console.log('✅ Supported:', supported);
      
      if (supported) {
        setHasPaymasterSupport(true);
        alert('✅ Sponsored gas is available! Gas-free transactions enabled.');
      } else {
        setHasPaymasterSupport(false);
        alert('❌ Sponsored gas not available. Using regular transactions.');
      }
      
    } catch (error) {
      const errorCode = (error as Error & { code?: number }).code;
      console.error('❌ Capability check failed:', error);
      
      if (errorCode === 4100) {
        alert('❌ Capabilities check not authorized. Please enable permissions in your wallet settings.');
      } else if (errorCode === 4200) {
        alert('❌ wallet_getCapabilities not supported by this wallet version.');
      } else {
        alert('❌ Error checking capabilities: ' + (error as Error).message);
      }
      
      setHasPaymasterSupport(false);
    }
  };
  
    // Check capabilities when address changes
    useEffect(() => {
      const checkCapabilities = async () => {
        if (!address) {
          setHasPaymasterSupport(false);
          return;
        }
        
        // Try to get the wallet provider from wagmi connector
        let walletProvider = null;
        
        // First try to get from wagmi connector
        if (connector?.getProvider) {
          try {
            walletProvider = await connector.getProvider();
            console.log('🔗 Auto-check using wagmi connector provider:', walletProvider);
          } catch (error) {
            console.log('Failed to get provider from connector:', error);
          }
        }
        // Fallback to window.ethereum
        if (!walletProvider && window.ethereum) {
          walletProvider = window.ethereum;
          console.log('🔗 Auto-check using window.ethereum provider:', walletProvider);
        }
        
        if (!walletProvider) {
          console.log('No wallet provider detected - skipping capability check');
          setHasPaymasterSupport(false);
          return;
        }
        
        try {
          const capabilities = await walletProvider.request({
            method: 'wallet_getCapabilities',
            params: [address]
          });
          
          const paymasterSupport = capabilities?.['0x2105']?.paymasterService?.supported;
          setHasPaymasterSupport(!!paymasterSupport);
          
          console.log('Paymaster support:', paymasterSupport);
          console.log('Full capabilities:', capabilities);
        } catch (error) {
          // Handle different types of errors gracefully
          const errorCode = (error as Error & { code?: number }).code;
          
          if (errorCode === 4100) {
            // User hasn't authorized capabilities check - this is normal
            console.log('Capabilities check not authorized by user - using regular transactions');
            setHasPaymasterSupport(false);
          } else if (errorCode === 4200) {
            // Method not supported by wallet
            console.log('wallet_getCapabilities not supported by this wallet');
            setHasPaymasterSupport(false);
          } else {
            // Other errors
            console.log('Error checking capabilities:', error);
            setHasPaymasterSupport(false);
          }
        }
      };
      
      checkCapabilities();
    }, [address, connector]);
  
  // Contract interaction hooks
  const { data: walletBalanceData, refetch: refetchWalletBalance } = useBalance({
    address: address,
    query: {
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
    },
  });
  
  
  const { data: userMiners, refetch: refetchUserMiners, error: userMinersError } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getMyMiners',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
      retry: 3, // Retry failed requests
      retryDelay: 5000, // Wait 5 seconds between retries
    },
  });
  
  const { data: userEggs, refetch: refetchUserEggs, error: userEggsError } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getMyEggs',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
      retry: 3, // Retry failed requests
      retryDelay: 5000, // Wait 5 seconds between retries
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
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
    },
  });
  // Get last hatch time for countdown
  const { data: lastHatchData, refetch: refetchLastHatch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'lastHatch',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  });

  // Get total TVL (ETH + Aave)
  const { data: totalBalanceData, refetch: refetchTotalBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getTotalBalance',
    query: {
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
    },
  });

  // Get balance breakdown (ETH vs Aave)
  const { data: balanceBreakdown, refetch: refetchBalanceBreakdown } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'getBalanceBreakdown',
    query: {
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
    },
  });

  // Get total Aave deposits (for yield tracking)
  const { data: totalAaveDeposits, refetch: refetchTotalAaveDeposits } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASEMINER_ABI,
    functionName: 'totalAaveDeposits',
    query: {
      refetchInterval: 30000, // Refetch every 30 seconds (reduced to avoid rate limits)
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
  const [isSponsoredHatching, setIsSponsoredHatching] = useState(false);
  const [sponsoredTxHash, setSponsoredTxHash] = useState<string | null>(null);
  
  // Info modal state
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  // Refetch data after successful transactions
  useEffect(() => {
    if (isConfirmed) {
      // Refetch all user data with a small delay to ensure contract state is updated
      setTimeout(() => {
        refetchWalletBalance();
        refetchUserMiners();
        refetchUserEggs();
        refetchEggValue();
        refetchLastHatch();
        refetchTotalBalance();
        refetchBalanceBreakdown();
        refetchTotalAaveDeposits();
        
        // Second refetch for egg value to ensure it gets updated data
        setTimeout(() => {
          refetchEggValue();
        }, 500);
      }, 1000); // 1 second delay
    }
  }, [isConfirmed, refetchWalletBalance, refetchUserMiners, refetchUserEggs, refetchEggValue, refetchLastHatch, refetchTotalBalance, refetchBalanceBreakdown, refetchTotalAaveDeposits]);

  const [frameAdded, setFrameAdded] = useState(false);
  const [inputAmount, setInputAmount] = useState("0");
  const [referralAddress, setReferralAddress] = useState<string>("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastKnownRewards, setLastKnownRewards] = useState("0");
  const [timeUntilHatch, setTimeUntilHatch] = useState<number>(0);
  const [hasNotifiedRefineReady, setHasNotifiedRefineReady] = useState(false);
  
  // Real-time data from contract
  const walletBalance = walletBalanceData ? formatEther(walletBalanceData.value) : "0";
  const totalTVL = totalBalanceData ? formatEther(totalBalanceData) : "0";

  const userGems = userMiners ? userMiners.toString() : "0";
  
  // Balance breakdown data
  const ethBalance = balanceBreakdown ? formatEther(balanceBreakdown[0]) : "0";
  const aaveBalance = balanceBreakdown ? formatEther(balanceBreakdown[1]) : "0";
  // Fixed allocation percentages (80% Aave, 20% Reserve) - kept for future use
  // const aavePercentage = 80; // Fixed target allocation
  // const reservePercentage = 20; // Fixed target allocation
  
  // Yield calculation (current Aave balance - total deposits = earned yield)
  const totalDeposits = totalAaveDeposits ? formatEther(totalAaveDeposits) : "0";
  const earnedYield = parseFloat(aaveBalance) - parseFloat(totalDeposits);
  
  // Loading states for individual values
  const isLoadingWalletBalance = !walletBalanceData && isConnected;
  const isLoadingTotalTVL = !totalBalanceData;
  const isLoadingUserData = isConnected && (userMiners === undefined || userEggs === undefined);
  const isLoadingRewards = !eggValue && !lastKnownRewards && isConnected;
  
  // Debug rate limit errors
  useEffect(() => {
    if (userMinersError) {
      console.error('User Miners Error:', userMinersError);
    }
    if (userEggsError) {
      console.error('User Eggs Error:', userEggsError);
    }
  }, [userMinersError, userEggsError]);
  
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

  // Sponsored hatching function using paymaster service
  const handleSponsoredHatch = async () => {
    if (!address || !hasPaymasterSupport) return;
    
    // Check if user has eggs to hatch
    if (!userEggs || userEggs === BigInt(0)) {
      console.log('❌ No eggs to hatch, falling back to regular transaction');
      await handleRefineGems();
      return;
    }
    
    console.log('🥚 User has eggs to hatch:', userEggs.toString());
    setIsSponsoredHatching(true);
    setSponsoredTxHash(null);
    
    try {
      // Get wallet provider
      let walletProvider = null;
      if (connector?.getProvider) {
        try {
          walletProvider = await connector.getProvider();
        } catch (error) {
          console.log('Failed to get provider from connector:', error);
        }
      }
      if (!walletProvider && window.ethereum) {
        walletProvider = window.ethereum;
      }
      
      if (!walletProvider) {
        console.log('No wallet provider detected - falling back to regular transaction');
        await handleRefineGems();
        return;
      }
      
      console.log('🚀 Executing sponsored transaction...');
      
      const result = await walletProvider.request({
        method: 'wallet_sendCalls',
        params: [{
          version: "1.0",
          chainId: "0x2105",
          from: address,
          calls: [{
            to: CONTRACT_ADDRESS,
            value: "0x0",
            data: "0x2296459e" // hatchEggs() function selector
          }],
          capabilities: {
            paymasterService: {
              url: "https://api.developer.coinbase.com/rpc/v1/base/mfOtCv7khgJXeeBl3el6YNvAbJcngkXU"
            }
          }
        }]
      });
      
      console.log('✅ Sponsored hatch transaction submitted:', result);
      setSponsoredTxHash(result);
      
      // Refetch data after successful sponsored transaction
      setTimeout(() => {
        refetchUserMiners();
        refetchUserEggs();
        refetchEggValue();
        refetchTotalBalance();
        refetchBalanceBreakdown();
        refetchTotalAaveDeposits();
        console.log('🔄 Data refetched after sponsored transaction');
      }, 2000);
      
    } catch (err) {
      console.error('❌ Error with sponsored hatching:', err);
      
      // Handle different error types
      const errorCode = (err as Error & { code?: number }).code;
      const errorMessage = (err as Error).message;
      
      if (errorCode === 4100) {
        console.log('🚫 Paymaster service not supported by wallet');
      } else if (errorCode === 4200) {
        console.log('❌ Invalid paymaster URL or unreachable');
      } else if (errorCode === 4300) {
        console.log('❌ Paymaster service returned an error or is unavailable');
      } else if (errorCode === 5700) {
        console.log('❌ Paymaster capability required but wallet doesn\'t support it');
      } else if (errorMessage?.includes('paymaster')) {
        console.log('❌ Paymaster-specific error:', errorMessage);
      } else {
        console.log('❌ Other error occurred:', err);
      }
      
      // Fallback to regular transaction
      console.log('🔄 Falling back to regular transaction');
      await handleRefineGems();
    } finally {
      setIsSponsoredHatching(false);
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
    
    const referralLink = `https://basemine.fun/ref/${address}`;
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
                      <span className="text-white font-semibold text-sm tracking-wide">TOTAL TVL</span>
                      <span className="text-white font-semibold text-sm">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-blue-300 font-medium text-[10px] tracking-wide">├─ Aave</span>
                      <span className="text-blue-300 font-medium text-[10px]">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-yellow-300 font-medium text-[10px] tracking-wide">├─ Yield</span>
                      <span className="text-yellow-300 font-medium text-[10px]">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-green-300 font-medium text-[10px] tracking-wide">└─ Reserve</span>
                      <span className="text-green-300 font-medium text-[10px]">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white font-semibold text-sm tracking-wide">WALLET</span>
                      <span className="text-white font-semibold text-sm">Loading...</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white font-semibold text-sm tracking-wide">GEMS</span>
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
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-semibold text-sm tracking-wide">TOTAL TVL</span>
                      <button
                        onClick={() => setShowTVLBreakdown(!showTVLBreakdown)}
                        className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                        title="Click to expand breakdown"
                      >
                        <svg 
                          className={`w-4 h-4 transition-transform duration-200 ${showTVLBreakdown ? 'rotate-180' : ''}`} 
                          fill="currentColor" 
                          viewBox="0 0 20 20"
                        >
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                    <span className="text-white font-semibold text-sm">
                      {isLoadingTotalTVL ? 'Loading...' : `${parseFloat(totalTVL).toFixed(3)} ETH`}
                    </span>
                  </div>
                  
                  {/* Collapsible TVL Breakdown */}
                  {showTVLBreakdown && (
                    <div className="space-y-2 pl-4 border-l-2 border-gray-600">
                      <div className="flex justify-between items-center">
                        <span className="text-blue-300 font-medium text-[10px] tracking-wide">├─ Aave</span>
                        <span className="text-blue-300 font-medium text-[10px]">
                          {isLoadingTotalTVL ? 'Loading...' : `${(parseFloat(aaveBalance) - earnedYield).toFixed(3)} ETH`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-green-300 font-medium text-[10px] tracking-wide">└─ Reserve</span>
                        <span className="text-green-300 font-medium text-[10px]">
                          {isLoadingTotalTVL ? 'Loading...' : `${parseFloat(ethBalance).toFixed(3)} ETH`}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium text-xs tracking-wide">WALLET</span>
                    <span className="text-white font-medium text-xs">
                      {isLoadingWalletBalance ? 'Loading...' : `${parseFloat(walletBalance).toFixed(3)} ETH`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium text-xs tracking-wide">GEMS</span>
                    <span className="text-white font-medium text-xs">
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
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-medium">REWARDS</span>
                      <button
                        onClick={() => setShowRewardsTooltip(!showRewardsTooltip)}
                        className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                        title="Click to see full precision"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                    <div className="relative">
                      <span className="text-white font-medium">
                        {isLoadingRewards ? 'Loading...' : `${truncateTo4Decimals(userRewards)} ETH`}
                      </span>
                      
                      {/* Tooltip */}
                      {showRewardsTooltip && (
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg border border-gray-700 whitespace-nowrap z-20">
                          <div className="text-center">
                            <div className="font-mono text-xs">
                              {isLoadingRewards ? 'Loading...' : `${parseFloat(userRewards).toFixed(8)} ETH`}
                            </div>
                          </div>
                          {/* Arrow */}
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={hasPaymasterSupport ? handleSponsoredHatch : handleRefineGems}
                      disabled={!isConnected || isRefining || isSponsoredHatching || !isHatchReady}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors pixel-font"
                      style={{ fontSize: '10px' }}
                    >
                      <div className="w-full h-full flex items-center justify-center" style={{ 
                        fontFamily: '"Press Start 2P", monospace',
                        letterSpacing: '0.5px',
                        textShadow: 'none'
                      }}>
                        {isRefining || isSponsoredHatching ? 'REFINING...' : 
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
                  <h3 className="text-white font-semibold text-sm tracking-wide mb-3">REFERRAL LINK</h3>
                  <div className="bg-gray-800 rounded-lg p-3 mb-3">
                    <p className="text-gray-300 text-xs break-all">
                      {address ? `https://basemine.fun/ref/${address}` : 'Connect wallet to get your referral link'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => {
                        if (address) {
                          navigator.clipboard.writeText(`https://basemine.fun/ref/${address}`);
                          setShowCopyNotification(true);
                          setTimeout(() => setShowCopyNotification(false), 2000); // Hide after 2 seconds
                        }
                      }}
                      disabled={!address}
                      className="bg-[#0927eb] hover:bg-[#0820d1] disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors text-xs"
                    >
                      {showCopyNotification ? 'COPIED!' : 'COPY LINK'}
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
                    Deposit ETH to buy gems. The more you invest, the more gems you get.
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-white mb-2">🔧&nbsp;&nbsp;Refine Gems</h3>
                  <p className="text-gray-300">
                    Convert gems into miners that generate more gems over time. 1-hour cooldown between refinements. Market grows by 0.167% on each refinement (4% daily).
                  </p>
                  {hasPaymasterSupport && (
                    <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded-lg">
                      <p className="text-green-400 text-sm font-medium">
                        🎉 Gas-free hatching available! Your transactions are sponsored.
                      </p>
                    </div>
                  )}
                  {!hasPaymasterSupport && address && (
                    <div className="mt-2 p-2 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                      <p className="text-blue-400 text-sm font-medium">
                        💡 Regular gas transactions will be used. Sponsored gas may be available with compatible wallets.
                      </p>
                      <button
                        onClick={checkCapabilitiesManually}
                        className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                      >
                        🔍 Check Sponsored Gas Support
                      </button>
                    </div>
                  )}
                  {sponsoredTxHash && (
                    <div className="mt-2 p-2 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                      <p className="text-blue-400 text-sm">
                        ✅ Sponsored transaction: <a href={`https://basescan.org/tx/${sponsoredTxHash}`} target="_blank" rel="noopener noreferrer" className="underline">{sponsoredTxHash.slice(0, 10)}...</a>
                      </p>
                    </div>
                  )}
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
                
                <div>
                  <h3 className="font-semibold text-yellow-400 mb-2">⚠️&nbsp;&nbsp;Disclaimer</h3>
                  <div className="text-gray-300 text-sm space-y-2">
                    <p><strong className="text-yellow-400">Risk Warning:</strong> This is a game with financial elements. Only invest what you can afford to lose.</p>
                    <p><strong className="text-yellow-400">No Guarantees:</strong> Returns are not guaranteed and may fluctuate based on market conditions.</p>
                    <p><strong className="text-yellow-400">DYOR:</strong> Always do your own research before participating in any DeFi protocols.</p>
                    <p><strong className="text-yellow-400">Smart Contract Risk:</strong> This protocol uses smart contracts that may contain bugs or vulnerabilities.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
