// Billing details PayPal needs for card payments, entered in CardPaymentFields. Not saved yet; card number and CVV never touch our system.
export interface CardBilling {
  cardholderName: string;
  receiptEmail: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export const emptyCardBilling: CardBilling = {
  cardholderName: '', receiptEmail: '', street: '', city: '', state: '', zip: '', country: 'US',
};
