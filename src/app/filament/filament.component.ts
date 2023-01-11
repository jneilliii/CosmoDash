import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { clamp } from 'lodash-es';
import { AnimationItem } from 'lottie-web';
import { AnimationOptions } from 'ngx-lottie';
import { take } from 'rxjs/operators';

import { ConfigService } from '../config/config.service';
import { FilamentSpool, PrinterStatus } from '../model';
import { FilamentService } from '../services/filament/filament.service';
import { PrinterService } from '../services/printer/printer.service';
import { SocketService } from '../services/socket/socket.service';

export enum EtapeFilament {
  Choix,
  Chauffage,
  Deplacement,
  Changement,
  Purge,
  End
}

@Component({
  selector: 'app-filament',
  templateUrl: './filament.component.html',
  styleUrls: ['./filament.component.scss'],
  providers: [FilamentService],
})
export class FilamentComponent implements OnInit {
  private totalPages = 5;
  private hotendPreviousTemperature = 0;
  public etape: EtapeFilament;
  public EtapeFilament = EtapeFilament;

  public page: number;
  public showCheckmark = false;
  public selectedSpool: FilamentSpool;
  public checkmarkOptions: AnimationOptions = {
    path: '/assets/checkmark.json',
    loop: false,
  };

  public constructor(
    private router: Router,
    private configService: ConfigService,
    private printerService: PrinterService,
    private socketService: SocketService,
    private filament: FilamentService,
  ) {
    this.socketService
      .getPrinterStatusSubscribable()
      .pipe(take(1))
      .subscribe((printerStatus: PrinterStatus): void => {
        this.hotendPreviousTemperature = printerStatus.tool0.set;
      });
  }

  public ngOnInit(): void {
    if (this.configService.isFilamentManagerEnabled()) {
      this.setPage(0);
      this.etape = EtapeFilament.Choix;
    } else {
      this.setPage(1);
      this.etape = EtapeFilament.Chauffage;
    }
  }

  public transition(direction: 'forward' | 'backward'): void {
    switch(this.etape) {
      case EtapeFilament.Choix:
        this.transitionChoix(direction);
        break;
      case EtapeFilament.Chauffage:
        this.transitionChauffage(direction);
        break;
      case EtapeFilament.Changement:
        this.transitionChangement(direction);
        break;
    }
    this.act();
  }

  private transitionChoix(direction: 'forward' | 'backward') {
    switch(direction) {
      case 'forward':
        this.etape = EtapeFilament.Chauffage;
        break;
      case 'backward':
        this.etape = EtapeFilament.End;
        break;
    }
  }

  private transitionChauffage(direction: 'forward' | 'backward') {
    if (direction === 'forward') {
      this.etape = EtapeFilament.Changement;
    } else {
      if (this.configService.isFilamentManagerEnabled()) {
        this.etape = EtapeFilament.Choix;
      } else {
        this.etape = EtapeFilament.End;
      }
    }
  }

  private transitionChangement(direction: 'forward' | 'backward') {
    switch(direction) {
      case 'forward':
        this.etape = EtapeFilament.End;
        break;
      case 'backward':
        this.etape = EtapeFilament.Chauffage;
        break;
    }
  }

  public act(): void {
    switch(this.etape) {
      case EtapeFilament.Changement:
        this.actChangement();
        break;
      case EtapeFilament.End:
        this.actEnd();
        break;
    }
  }

  private actChangement() {
    this.printerService.executeGCode('M600');
    this.transition('forward');
  }

  private actEnd() {
    this.navigateToMainScreen();
  }

  private navigateToMainScreen() {
    this.router.navigate(['/main-screen']);
  }

  public increasePage(): void {
    this.transition('forward');
  }

  public decreasePage(): void {
    this.transition('backward');
  }

  private setPage(page: number): void {
    setTimeout((): void => {
      const progressBar = document.getElementById('progressBar');
      if (progressBar) {
        document.getElementById('progressBar').style.width = this.page * (20 / this.totalPages) + 'vw';
      }
    }, 200);
    this.page = clamp(this.page, 0, this.totalPages);
  }

  public setSpool(spoolInformation: { spool: FilamentSpool; skipChange: boolean }): void {
    this.selectedSpool = spoolInformation.spool;
    if (spoolInformation.skipChange) {
      this.setSpoolSelection();
    } else {
      this.increasePage();
    }
  }

  public setSpoolSelection(): void {
    if (this.selectedSpool) {
      this.filament
        .setSpool(this.selectedSpool)
        .then((): void => {
          this.showCheckmark = true;
          setTimeout(() => {
            this.etape = EtapeFilament.End;
            this.act();
          }, 1350);
        })
        .catch(() => {
          this.etape = EtapeFilament.End;
          this.act();
        });
    } else {
      this.etape = EtapeFilament.End;
      this.act();
    }
  }

  public get currentSpool(): FilamentSpool {
    return this.filament.getCurrentSpool();
  }

  public setAnimationSpeed(animation: AnimationItem): void {
    animation.setSpeed(0.55);
  }
}
