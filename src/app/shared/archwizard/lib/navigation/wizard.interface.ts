import { EventEmitter, InjectionToken } from "@angular/core";
import { WizardStep } from "../util/wizard-step.interface";

export const WIZARD_TOKEN = new InjectionToken<Wizard>('WIZARD_TOKEN');

/**03/07/2024: This interface has been defined to decouple wizard-navigation-bar component 
 * from wizard component, thus making it possible to compile the package in 
 * partialMode, so that it's possible to publish it on NPM */
export interface Wizard {
    navBarDirection: string;
    get wizardSteps(): WizardStep[];
    disableNavigationBar: boolean;
    isNavigable(destinationIndex: number): boolean;
    getIndexOfStep(step: WizardStep): number;
    get completed(): boolean;

    getIndexOfStepWithId(stepId: string): number;
    goToStep(destinationIndex: number, preFinalize?: EventEmitter<void>, postFinalize?: EventEmitter<void>): void;
}