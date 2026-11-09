import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
  { path: 'v/:code', loadComponent: () => import('./pages/trip.page').then((m) => m.TripPage) },
  { path: '**', redirectTo: '' },
];
