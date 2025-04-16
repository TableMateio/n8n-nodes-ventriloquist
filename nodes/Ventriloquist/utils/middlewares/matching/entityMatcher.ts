/**
 * Interface for entity matcher implementation
 */
export interface IEntityMatcher {
    execute(): Promise<any>;
}
