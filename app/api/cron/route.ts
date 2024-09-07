import { NextResponse } from "next/server";
import { getLowestPrice, getHighestPrice, getAveragePrice, getEmailNotifType } from "@/lib/utlis";
import { connectToDb } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scrapper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await connectToDb();

    const products = await Product.find({});

    if (!products || products.length === 0) throw new Error("No products fetched");

    const updatedProducts = await Promise.all(
      products.map(async (currentProduct) => {
        try {
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);

          if (!scrapedProduct) {
            console.log(`Failed to scrape product: ${currentProduct.url}`);
            return currentProduct;
          }

          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const product = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          const updatedProduct = await Product.findOneAndUpdate(
            { url: product.url },
            product,
            { new: true }
          );

          if (!updatedProduct) {
            console.log(`Failed to update product: ${product.url}`);
            return currentProduct;
          }

          const emailNotifType = getEmailNotifType(scrapedProduct, currentProduct);

          if (emailNotifType && updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
            };
            const emailContent = await generateEmailBody(productInfo, emailNotifType);
            const userEmails = updatedProduct.users.map((user: any) => user.email);
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        } catch (error) {
          console.error(`Error processing product ${currentProduct.url}:`, error);
          return currentProduct;
        }
      })
    );

    return NextResponse.json({
      message: "Ok",
      data: updatedProducts,
    });
  } catch (error: any) {
    console.error("Failed to get all products:", error);
    return NextResponse.json({
      message: `Failed to get all products: ${error.message}`,
      error: true,
    }, { status: 500 });
  }
}
