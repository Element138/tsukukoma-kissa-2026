export function routeByActorType(actorType: string) {
  switch (actorType) {
    case "POS":
      return "/pos";
    case "KITCHEN":
      return "/kitchen";
    case "WAITER":
      return "/waiter";
    case "MENU_DISPLAY":
      return "/menu-display";
    case "ADMIN":
      return "/admin";
    default:
      return "/login";
  }
}
