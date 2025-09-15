"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface RefPageProps {
  params: Promise<{
    address: string;
  }>;
}

export default function RefPage({ params }: RefPageProps) {
  const router = useRouter();
  const [referralAddress, setReferralAddress] = useState<string>('');

  useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setReferralAddress(resolvedParams.address);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!referralAddress) return;
    
    if (referralAddress && referralAddress.startsWith('0x') && referralAddress.length === 42) {
      // Redirect to main page with ref parameter
      router.replace(`/?ref=${referralAddress}`);
    } else {
      // Invalid referral address, redirect to main page
      router.replace('/');
    }
  }, [referralAddress, router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-white text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
        <p>Redirecting...</p>
      </div>
    </div>
  );
}
