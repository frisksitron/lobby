import type { Component } from "solid-js"

interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  class?: string
}

const VolumeSlider: Component<VolumeSliderProps> = (props) => {
  const min = () => props.min ?? 0
  const max = () => props.max ?? 200

  const percentage = () => ((props.value - min()) / (max() - min())) * 100

  return (
    <div class={`relative flex items-center ${props.class || ""}`}>
      <input
        type="range"
        min={min()}
        max={max()}
        value={props.value}
        onInput={(e) => props.onChange(parseInt(e.currentTarget.value, 10))}
        class="w-full h-2 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-text-primary
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-md
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-110
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-text-primary
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${percentage()}%, var(--color-surface-elevated) ${percentage()}%, var(--color-surface-elevated) 100%)`
        }}
      />
    </div>
  )
}

export default VolumeSlider
