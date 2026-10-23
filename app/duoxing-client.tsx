'use client';
import dynamic from 'next/dynamic';
const Duoxing = dynamic(() => import('../client/App'), {ssr:false});
export default function DuoxingClient(){ return <Duoxing/>; }
