# Digigamez — werkafspraken

[PLAN.md](./PLAN.md) is de bron voor het ontwerp: architectuur, visuele
richting, spellenlijst en de kandidatenlijst (§6c). Lees dat eerst bij een
nieuw spel of een grotere wijziging.

## Git

**Altijd committen en pushen.** Werk dat af is hoort niet in de working tree te
blijven staan: sluit elke taak af met een commit en een `git push` naar
`origin main`, zonder daar apart om te vragen. De push naar `main` triggert de
GitHub Actions-deploy naar Pages, dus dat is ook het moment waarop het bord de
wijziging krijgt.

Commitberichten volgen de bestaande stijl in `git log`: Engels, een korte
beschrijvende titel zonder prefix (geen `feat:`/`fix:`), en daaronder een body
in proza die uitlegt *waarom* iets zo is gedaan — niet een opsomming van
gewijzigde bestanden. Geen attributie-footer.
