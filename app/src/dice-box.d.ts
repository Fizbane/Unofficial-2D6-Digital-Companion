declare module "@3d-dice/dice-box" {
  export default class DiceBox {
    constructor(config: Record<string, unknown>);
    init(): Promise<void>;
    roll(notation: unknown, options?: Record<string, unknown>): Promise<any[]>;
    clear(): void;
    hide(className?: string): void;
    show(): void;
  }
}
