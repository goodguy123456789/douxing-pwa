import type { Metadata, Viewport } from 'next';
import '../client/index.css';
export const metadata:Metadata={title:'都行 · 今晚吃什么',description:'两个人悄悄选好口味，一起决定今晚吃什么。',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'default',title:'都行'},icons:{icon:'/icons/icon-192.png',apple:'/icons/icon-180.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#f8f3e8'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang='zh-CN'><body>{children}</body></html>;}
