import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatRippleModule } from "@angular/material/core";
import { Router } from "@angular/router";
import { RouterTestingModule } from "@angular/router/testing";
import { ElectronService } from "ngx-electron";
import { Observable } from "rxjs";
import { ConfigService } from "../config/config.service";
import { MainScreenComponent } from "../main-screen/main-screen.component";
import { FilamentPluginService } from "../services/filament/filament-plugin.service";
import { PrinterService } from "../services/printer/printer.service";
import { SocketService } from "../services/socket/socket.service";
import { ChangeFilamentComponent } from "./change-filament/change-filament.component";
import { ChooseFilamentComponent } from "./choose-filament/choose-filament.component";
import { EtapeFilament, FilamentComponent } from "./filament.component";
import { HeatNozzleComponent } from "./heat-nozzle/heat-nozzle.component";
import { MoveFilamentComponent } from "./move-filament/move-filament.component";
import { PurgeFilamentComponent } from "./purge-filament/purge-filament.component";

describe("FilamentComponent", () => {
    let fixture: ComponentFixture<FilamentComponent>;
    let component: FilamentComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                RouterTestingModule.withRoutes([
                    {path: 'main-screen', component: MainScreenComponent},
                    {path: 'filament', component: FilamentComponent}
                ]),
                MatRippleModule
            ],
            declarations: [
                FilamentComponent,
                ChangeFilamentComponent,
                ChooseFilamentComponent,
                HeatNozzleComponent,
                MoveFilamentComponent,
                PurgeFilamentComponent,
                MainScreenComponent
            ],
            providers: [
                { provide: ConfigService, useValue:
                    {
                        isFilamentManagerEnabled: () => false,
                        getAutomaticHeatingStartSeconds: () => -1,
                        getDefaultHotendTemperature: () => 200
                    }
                },
                { provide: PrinterService, useValue:
                    {
                        setTemperatureHotend: () => {},
                        executeGCode: () => {}
                    }
                },
                { provide: SocketService, useValue: {getPrinterStatusSubscribable: () => new Observable()} },
                { provide: FilamentPluginService, useValue: {getSpools: () => new Observable(), getCurrentSpool: () => new Observable()} },
                { provide: ElectronService, useValue: {ipcRenderer: {addListener: () => {}, send: () => {}}} },
            ]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(FilamentComponent);
        component  = fixture.componentInstance;
    })

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    describe('change d\'etat correctement', () => {
        it('commence à l\'état Chauffage', () => {
            fixture.detectChanges();
            expect(component.etape).toEqual(EtapeFilament.Chauffage);
        });

        describe('en marche avant', () => {
            it('depuis Etape Choix', () => {
                component.etape = EtapeFilament.Choix as EtapeFilament;
                component.transition('forward');
                expect(component.etape).toBe(EtapeFilament.Chauffage);
            });

            it('depuis Etape Chauffage', () => {
                component.etape = EtapeFilament.Chauffage as EtapeFilament;
                component.transition('forward');
                expect(component.etape).toEqual(EtapeFilament.End);
            });

            it('depuis Etape Changement', () => {
                component.etape = EtapeFilament.Changement as EtapeFilament;
                component.transition('forward');
                expect(component.etape).toEqual(EtapeFilament.End);
            });
        });

        describe('en marche arrière', () => {
            it('depuis Etape Choix', () => {
                component.etape = EtapeFilament.Choix as EtapeFilament;
                component.transition('backward');
                expect(component.etape).toBe(EtapeFilament.End);
            });

            it('depuis Etape Chauffage', () => {
                component.etape = EtapeFilament.Chauffage as EtapeFilament;
                component.transition('backward');
                expect(component.etape).toEqual(EtapeFilament.End);
            });

            it('depuis Etape Changement', () => {
                component.etape = EtapeFilament.Changement as EtapeFilament;
                component.transition('backward');
                expect(component.etape).toEqual(EtapeFilament.Chauffage);
            });
        });

        it('déclenche un M600 puis redirige vers le menu principal', () => {
            component.etape = EtapeFilament.Chauffage as EtapeFilament;
            const printerService = TestBed.inject(PrinterService);
            spyOn(printerService, 'executeGCode');
            const router = TestBed.inject(Router);
            spyOn(router, "navigate");

            component.transition('forward');

            expect(component.etape).toBe(EtapeFilament.End);
            expect(printerService.executeGCode).toHaveBeenCalledWith('M600');
            expect(router.navigate).toHaveBeenCalledWith(['/main-screen']);
        });
    });
});