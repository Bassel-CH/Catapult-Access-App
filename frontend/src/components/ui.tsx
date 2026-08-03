/** Tiny presentational primitives shared across the phases. */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>
}

export function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 mb-3.5">
      <div>
        <h2 className="text-[17px] font-semibold m-0">{title}</h2>
        {sub && <p className="text-muted text-[13px] mt-1 mb-0">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

type Variant = 'default' | 'primary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
}

export function Button({ variant = 'default', size = 'md', className = '', ...rest }: ButtonProps) {
  const base = 'inline-flex items-center gap-2 rounded-lg font-semibold border transition-colors disabled:cursor-not-allowed'
  const sizing = size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-4 py-2'
  const variants: Record<Variant, string> = {
    default: 'bg-white border-line text-ink hover:border-[#c4cad6]',
    primary: 'bg-brand border-brand text-white hover:bg-brand-ink disabled:bg-[#aab6d8] disabled:border-[#aab6d8]',
    ghost: 'bg-transparent border-transparent text-ink hover:bg-black/5',
  }
  return <button className={`${base} ${sizing} ${variants[variant]} ${className}`} {...rest} />
}

type Tone = 'default' | 'brand' | 'keep' | 'revoke' | 'flag'

export function Pill({ tone = 'default', children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    default: 'bg-[#eef1f6] text-[#41485a]',
    brand: 'bg-brand-soft text-brand-ink',
    keep: 'bg-keep-soft text-keep',
    revoke: 'bg-revoke-soft text-revoke',
    flag: 'bg-flag-soft text-flag',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}
